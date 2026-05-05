# Tech Grid

Daily Immaculate-Grid-style puzzle for tech products. New 3×3 grid generated every morning at 9 AM ET, embedded into article pages, with a private admin dashboard for editing today's and tomorrow's puzzle.

## What's in this folder

```
tech-grid-game/
├── supabase/
│   ├── 01_schema.sql        # tables + RLS
│   ├── 02_seed.sql          # ~140 hand-curated products, ~30 categories
│   ├── 03_functions.sql     # RPCs (submit_guess, finalize_game, …)
│   ├── 04_cron.sql          # daily 9 AM ET puzzle generation
│   └── 05_typeahead.sql     # server-side product search RPC
├── scripts/
│   └── scrape_wikidata.py   # pull thousands more products from Wikidata
├── game/
│   ├── index.html           # standalone test page
│   ├── styles.css           # scoped under .tgg- so it won't fight CMS styles
│   └── game.js              # the embeddable game (no dependencies)
├── admin/
│   ├── index.html           # private admin dashboard
│   ├── admin.css
│   └── admin.js
└── README.md
```

## 1. Supabase setup (one-time)

1. Create a free project at <https://supabase.com>. Pick a region close to your readers.
2. Go to **Database → Extensions** and enable `pg_cron` and `pg_trgm` (they may already be on).
3. Go to **SQL Editor → New query** and run, in order:
   - `supabase/01_schema.sql`
   - `supabase/02_seed.sql`         (curated starter set, ~140 products)
   - `supabase/03_functions.sql`
   - `supabase/05_typeahead.sql`    (server-side product search)
   - `supabase/04_cron.sql`         (daily generator + first puzzles)
4. *(Optional but recommended)* run `scripts/scrape_wikidata.py` to add several thousand more products — see Section 2 below. Then run the resulting `02b_seed_wikidata.sql`.
5. Note your project's **Project URL** and **anon public key** (Settings → API). The anon key is safe to expose in the browser.
6. Note your **service_role key** as well, but **never** put it in the embed. It's only used by the admin dashboard.

`pg_cron` runs the daily scheduler and `pg_trgm` powers the fuzzy match in server-side typeahead. `04_cron.sql` schedules the daily generator and creates today's and tomorrow's puzzles immediately so you can test right away.

## 2. Bulk-import products from Wikidata

The starter seed has ~140 hand-curated products — enough to play, but the rarity scoring gets more interesting with thousands. The `scripts/scrape_wikidata.py` script pulls consumer tech products from Wikidata (smartphones, laptops, cameras, OSes, browsers, streaming services, etc.) and emits SQL inserts.

```powershell
# From the repo root, with Python 3.8+ on PATH:
python scripts/scrape_wikidata.py > supabase/02b_seed_wikidata.sql
```

The script takes 1–2 minutes (Wikidata is rate-limited; each query sleeps 1 second). Realistic yield is **5,000–8,000 unique products** after deduplication — Wikidata's coverage drops off into obscure regional models past that point. Run the resulting SQL file in the Supabase SQL Editor; it uses `ON CONFLICT (slug) DO NOTHING` so it's safe to re-run.

After importing, click **Refresh product → category mappings** in the admin Catalog tab (or run `select refresh_product_categories();` in SQL Editor) so the new products get categorized.

**About data quality:** Wikidata is editorial-quality but inconsistent. Some imported products will have missing release years or unrecognizable names. Use the admin's `is_active` toggle (or `update products set is_active = false where ...` in SQL) to hide low-quality entries without deleting them.

## 3. Embedding in Valnet CMS

The CMS lets you drop in raw HTML in custom embed blocks. Host the three files (`styles.css`, `game.js`, plus an optional shared favicon) somewhere your site can serve — Valnet's static asset bucket, an S3/Cloudflare R2 bucket, or even GitHub Pages will work. Then the embed block becomes:

```html
<link rel="stylesheet" href="https://cdn.example.com/tech-grid/styles.css">
<div id="tech-grid-root"></div>
<script>
  window.TECH_GRID_CONFIG = {
    supabaseUrl:    'https://YOUR-PROJECT.supabase.co',
    supabaseAnonKey:'YOUR_ANON_PUBLIC_KEY'
  };
</script>
<script src="https://cdn.example.com/tech-grid/game.js" defer></script>
```

If the CMS strips inline `<script>` tags, the simpler fallback is an iframe pointing at a static page that already has the config baked in:

```html
<iframe src="https://cdn.example.com/tech-grid/" width="100%" height="780" style="border:0"></iframe>
```

The page is mobile-friendly and roughly 720px wide × 700px tall when the leaderboard tab is open.

## 4. Admin dashboard

The admin tool needs the **service_role key**, which bypasses Row Level Security — treat it like a database password. Don't commit it anywhere, and don't load the admin page from the public article.

1. Host `admin/` privately (e.g. on your laptop with `python -m http.server`, or on a password-protected internal page). Don't put it on the public CDN you use for the embed.
2. Open `admin/index.html` in a browser, paste your Supabase URL and service_role key, click **Unlock**.
3. You'll see four tabs:
   - **Today** — shows today's puzzle. You can swap any row/column category, save changes, or regenerate.
   - **Tomorrow** — same, but for the puzzle that goes live at 9 AM ET tomorrow. Edit ahead of time without affecting today's game.
   - **Other day** — pick any future date.
   - **Catalog** — clicks one button to recompute product/category mappings after you've added or edited products or categories in Supabase Studio.

The key is held only in `sessionStorage` and is dropped when you close the tab.

### Editing the catalog

For most product/category edits, open Supabase Studio → Table Editor and edit `products` or `categories` directly. After any of:
- Adding/removing a product
- Changing a product's `tags`, `manufacturer`, `kind`, or `release_year`
- Adding/changing a category's `rule`

…click **Refresh product → category mappings** in the admin Catalog tab so the live counts update.

## 5. How the puzzle generation works

- A row in `puzzles` is created for each calendar date in the America/New_York zone.
- `generate_puzzle_for_date(date)` picks 6 random active categories with at least 6 products each, and validates that every (row × column) intersection has ≥ 3 valid products. It retries up to 200 times with different combinations.
- `pg_cron` runs every hour and calls the generator only when the local hour is 9, generating **tomorrow's** puzzle. So at 9 AM ET on March 4, the puzzle for March 5 is created and ready to go live overnight.
- Admin edits to a date that already exists are saved as `UPDATE` and override the auto-generated one. Replacing a puzzle that players have already played will leave their results pointing at the now-changed categories — only do that for upcoming dates.

## 6. How rarity scoring works

Every correct guess records `(puzzle_id, row, col, product_id)`. After a guess:

```
percent_picked = round(100 * pickers_for_this_product / total_correct_for_cell)
rarity         = 100 - percent_picked
```

So a unique correct answer scores 100; the most popular answer scores 0–10. The total **rarity score** for the day is the sum across all 9 cells. The leaderboard is sorted by rarity score, then by correct count, then by completion time.

## 7. Streaks & stats without login

Each browser gets a UUID stored in `localStorage` (`tgg.player.v1`). It's sent with every guess, used to:
- prevent guessing the same cell twice on the same day,
- carry your streak across days (`finalize_game` updates the `players` row),
- attach your chosen display name to leaderboard entries.

If a user clears site data, they start fresh — same as NYT-style daily games.

## 8. Local development

Open `game/index.html` directly in a browser after editing the inline `TECH_GRID_CONFIG` with your Supabase URL and anon key. Same for `admin/index.html`. No build step.

## 9. Things you may want to extend later

- **More categories**: insert into `categories` with a `rule` JSON of the form
  `{"manufacturer":["Apple"], "tags":["wearable"], "kind":"hardware", "year_min":2020, "year_max":2024}`.
  A category matches a product if any of those clauses match.
- **More products**: add rows to `products`, then click **Refresh mappings** in admin.
- **Featured products**: add a `priority` column to `products` and use it to weight typeahead.
- **Daily share image**: add a `/share` route that renders the user's grid emoji-style for X/Threads.
