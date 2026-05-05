-- =====================================================================
-- Fixes pass:
--   1. Rule semantics: AND across specified clauses (was OR), so
--      "Audio Hardware" can require kind=hardware AND tag=audio.
--   2. Tighten / deactivate problem categories.
--   3. Drop unique index on (puzzle, player, row, col) so a wrong cell
--      can be re-attempted. Cell stays unlockable once a CORRECT answer
--      is recorded.
--   4. submit_guess: prevent re-using a product across cells; allow
--      re-guess on wrong cells; new "product_already_used" reason.
--   5. finalize_game: combined score = correct*100 + sum(rarity), so
--      9 correct (all popular) > 0 correct.
--   6. Re-run refresh_product_categories with new semantics.
--   7. Wipe and regenerate today + tomorrow so puzzles reflect new data.
--
-- Run AFTER 03_functions.sql, 04_cron.sql, 05_typeahead.sql.
-- Re-runnable: every statement is idempotent.
-- =====================================================================

-- 1. New AND-with-optional-clauses semantics
create or replace function refresh_product_categories()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from product_categories;

  insert into product_categories (product_id, category_id)
  select p.id, c.id
  from products p
  cross join categories c
  where p.is_active and c.is_active
    -- guard: empty rule should not match everything
    and c.rule != '{}'::jsonb
    -- manufacturer: if specified, must match
    and (
      not (c.rule ? 'manufacturer')
      or exists (
        select 1 from jsonb_array_elements_text(c.rule->'manufacturer') as m(value)
        where lower(p.manufacturer) = lower(m.value)
      )
    )
    -- kind: if specified, must match
    and (
      not (c.rule ? 'kind')
      or p.kind = (c.rule->>'kind')
    )
    -- year range: if specified, must match
    and (
      not (c.rule ? 'year_min' or c.rule ? 'year_max')
      or (
        p.release_year is not null
        and p.release_year >= coalesce((c.rule->>'year_min')::int, -1000000)
        and p.release_year <= coalesce((c.rule->>'year_max')::int,  1000000)
      )
    )
    -- tags: if specified, product must have at least one matching tag
    and (
      not (c.rule ? 'tags')
      or exists (
        select 1 from jsonb_array_elements_text(c.rule->'tags') as t(value)
        where t.value = any(p.tags)
      )
    );
end;
$$;
revoke execute on function refresh_product_categories() from public, anon;

-- 2. Tighten / deactivate problem categories.
-- The "Runs on X" categories were ambiguous: hardware uses an OS tag
-- because IT IS that platform, but apps don't carry platform tags. Until
-- we add proper platform metadata to software, deactivate these rather
-- than ship misleading puzzles.
update categories set is_active = false
 where name in (
   'Runs on Android',
   'Runs on iOS / iPadOS',
   'Runs on Windows',
   'Runs on macOS',
   'Runs on Linux'
 );

-- Audio Hardware: must be hardware AND audio-tagged
update categories
   set rule = '{"kind":"hardware","tags":["audio"]}'::jsonb
 where name = 'Audio Hardware';

-- Camera / Imaging: only hardware
update categories
   set rule = '{"kind":"hardware","tags":["camera"]}'::jsonb
 where name = 'Camera / Imaging';

-- Smart Home: keep tag-based but constrain to hardware so the apps
-- don't leak in (Alexa app, Google Home app, etc.)
update categories
   set rule = '{"kind":"hardware","tags":["smart-home"]}'::jsonb
 where name = 'Smart Home';

-- Streaming Service: software only (the "Streaming device" hardware
-- already has its own coverage via Hardware × tags)
update categories
   set rule = '{"kind":"software","tags":["streaming"]}'::jsonb
 where name = 'Streaming Service';

-- Productivity Tool: software only
update categories
   set rule = '{"kind":"software","tags":["productivity"]}'::jsonb
 where name = 'Productivity Tool';

-- Communication / Chat: software only
update categories
   set rule = '{"kind":"software","tags":["communication"]}'::jsonb
 where name = 'Communication / Chat';

-- Browser: software only (in case any hardware leaks in via aliases)
update categories
   set rule = '{"kind":"software","tags":["browser"]}'::jsonb
 where name = 'Browser';

-- Developer Tool: software only
update categories
   set rule = '{"kind":"software","tags":["developer"]}'::jsonb
 where name = 'Developer Tool';

-- Creative Tool: software only
update categories
   set rule = '{"kind":"software","tags":["creative"]}'::jsonb
 where name = 'Creative Tool';

-- Social Network: software only
update categories
   set rule = '{"kind":"software","tags":["social"]}'::jsonb
 where name = 'Social Network';

-- Cloud Storage: software only
update categories
   set rule = '{"kind":"software","tags":["cloud","storage"]}'::jsonb
 where name = 'Cloud Storage';

-- AI / LLM Product: software only
update categories
   set rule = '{"kind":"software","tags":["ai"]}'::jsonb
 where name = 'AI / LLM Product';

-- Mobile App / Web App / Desktop App: explicitly software
update categories set rule = '{"kind":"software","tags":["mobile-app","mobile"]}'::jsonb where name = 'Mobile App';
update categories set rule = '{"kind":"software","tags":["web-app"]}'::jsonb               where name = 'Web App';
update categories set rule = '{"kind":"software","tags":["desktop-app"]}'::jsonb           where name = 'Desktop App';

-- 3. Drop the per-cell unique index. A cell stays "locked" once a
-- correct guess exists; multiple wrong guesses are allowed.
drop index if exists guesses_one_per_cell;

-- 4. submit_guess rewrite
create or replace function submit_guess(
  p_puzzle_id uuid,
  p_player_id uuid,
  p_row_idx int,
  p_col_idx int,
  p_raw_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  puzzle_row    puzzles%rowtype;
  row_cat_id    uuid;
  col_cat_id    uuid;
  matched       products%rowtype;
  is_valid      boolean := false;
  total_correct int := 0;
  same_pick     int := 0;
  rarity        int := 100;
  percent_pick  int := 0;
  cleaned       text;
begin
  cleaned := lower(trim(p_raw_text));
  if cleaned = '' or cleaned is null then
    return jsonb_build_object('is_correct', false, 'reason', 'empty');
  end if;

  -- Ensure the player row exists (FK target).
  insert into players (id) values (p_player_id) on conflict (id) do nothing;

  -- If this cell is already SOLVED for this player, refuse silently
  -- (no insert, no count). Wrong-only history doesn't lock the cell.
  if exists (
    select 1 from guesses
     where puzzle_id = p_puzzle_id and player_id = p_player_id
       and row_idx = p_row_idx and col_idx = p_col_idx
       and is_correct
  ) then
    return jsonb_build_object('is_correct', false, 'reason', 'cell_already_correct');
  end if;

  select * into puzzle_row from puzzles where id = p_puzzle_id;
  if not found then
    return jsonb_build_object('is_correct', false, 'reason', 'unknown_puzzle');
  end if;

  row_cat_id := puzzle_row.row_categories[p_row_idx + 1];
  col_cat_id := puzzle_row.col_categories[p_col_idx + 1];

  -- Resolve product by name / alias / slug
  select p.* into matched
    from products p
    where p.is_active
      and (
        lower(p.name) = cleaned
        or cleaned = any(array(select lower(unnest(p.aliases))))
        or p.slug = regexp_replace(cleaned, '[^a-z0-9]+', '-', 'g')
      )
    order by length(p.name) asc
    limit 1;

  if not found then
    insert into guesses (puzzle_id, player_id, row_idx, col_idx, raw_text, is_correct)
    values (p_puzzle_id, p_player_id, p_row_idx, p_col_idx, p_raw_text, false);
    return jsonb_build_object('is_correct', false, 'reason', 'unknown_product');
  end if;

  -- Validate intersection
  select
    exists (select 1 from product_categories where product_id = matched.id and category_id = row_cat_id)
    and exists (select 1 from product_categories where product_id = matched.id and category_id = col_cat_id)
    into is_valid;

  if not is_valid then
    insert into guesses (puzzle_id, player_id, row_idx, col_idx, raw_text, product_id, is_correct)
    values (p_puzzle_id, p_player_id, p_row_idx, p_col_idx, p_raw_text, matched.id, false);
    return jsonb_build_object(
      'is_correct', false,
      'reason', 'wrong_intersection',
      'product', jsonb_build_object('id', matched.id, 'name', matched.name)
    );
  end if;

  -- Reject re-using a product the player has already used correctly
  if exists (
    select 1 from guesses
     where puzzle_id = p_puzzle_id and player_id = p_player_id
       and product_id = matched.id and is_correct
  ) then
    insert into guesses (puzzle_id, player_id, row_idx, col_idx, raw_text, product_id, is_correct)
    values (p_puzzle_id, p_player_id, p_row_idx, p_col_idx, p_raw_text, matched.id, false);
    return jsonb_build_object(
      'is_correct', false,
      'reason', 'product_already_used',
      'product', jsonb_build_object('id', matched.id, 'name', matched.name)
    );
  end if;

  -- Correct
  insert into guesses (puzzle_id, player_id, row_idx, col_idx, raw_text, product_id, is_correct)
  values (p_puzzle_id, p_player_id, p_row_idx, p_col_idx, p_raw_text, matched.id, true);

  -- Compute rarity
  select count(*) into total_correct
    from guesses
    where puzzle_id = p_puzzle_id and row_idx = p_row_idx and col_idx = p_col_idx and is_correct;

  select count(*) into same_pick
    from guesses
    where puzzle_id = p_puzzle_id and row_idx = p_row_idx and col_idx = p_col_idx
      and is_correct and product_id = matched.id;

  if total_correct > 0 then
    percent_pick := round(100.0 * same_pick / total_correct);
  end if;
  rarity := 100 - percent_pick;

  return jsonb_build_object(
    'is_correct', true,
    'rarity', rarity,
    'percent_picked', percent_pick,
    'product', jsonb_build_object(
      'id', matched.id,
      'name', matched.name,
      'manufacturer', matched.manufacturer,
      'kind', matched.kind,
      'release_year', matched.release_year
    )
  );
end;
$$;
grant execute on function submit_guess(uuid, uuid, int, int, text) to anon, authenticated;

-- 5. finalize_game: combined score = correct_count * 100 + sum(rarity)
create or replace function finalize_game(
  p_puzzle_id uuid,
  p_player_id uuid,
  p_display_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  correct_n   int;
  rarity_sum  int;
  total_score int;
  player_row  players%rowtype;
  puzzle_row  puzzles%rowtype;
  yesterday   date;
begin
  select * into puzzle_row from puzzles where id = p_puzzle_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_puzzle');
  end if;

  insert into players (id, display_name)
  values (p_player_id, p_display_name)
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, players.display_name);

  -- Per-cell rarity: 100 - round(100 * same_product_pickers / total_correct_pickers)
  select count(*),
         coalesce(sum(
           case when total.cnt = 0 then 100
                else 100 - round(100.0 * same.cnt / total.cnt)
           end
         )::int, 0)
    into correct_n, rarity_sum
    from (
      select row_idx, col_idx, product_id
        from guesses
        where puzzle_id = p_puzzle_id and player_id = p_player_id and is_correct
    ) mine
    cross join lateral (
      select count(*) as cnt
        from guesses g
        where g.puzzle_id = p_puzzle_id
          and g.row_idx = mine.row_idx
          and g.col_idx = mine.col_idx
          and g.is_correct
          and g.product_id = mine.product_id
    ) same
    cross join lateral (
      select count(*) as cnt
        from guesses g
        where g.puzzle_id = p_puzzle_id
          and g.row_idx = mine.row_idx
          and g.col_idx = mine.col_idx
          and g.is_correct
    ) total;

  -- Combined score: 100 per correct cell + rarity bonus per cell.
  -- 9 correct, all popular = 900. 9 correct, all unique = 1800.
  -- 0 correct = 0. Always orders correctness above rarity.
  total_score := correct_n * 100 + rarity_sum;

  insert into game_results (puzzle_id, player_id, correct_count, rarity_score)
  values (p_puzzle_id, p_player_id, correct_n, total_score)
  on conflict (puzzle_id, player_id) do update
    set correct_count = excluded.correct_count,
        rarity_score  = excluded.rarity_score,
        completed_at  = now();

  select * into player_row from players where id = p_player_id;
  yesterday := puzzle_row.puzzle_date - interval '1 day';

  update players
     set games_played  = games_played + 1,
         total_correct = total_correct + correct_n,
         perfect_games = perfect_games + (case when correct_n = 9 then 1 else 0 end),
         current_streak = case
           when correct_n >= 1 and player_row.last_played = yesterday
             then player_row.current_streak + 1
           when correct_n >= 1
             then 1
           else 0
         end,
         max_streak = greatest(
           player_row.max_streak,
           case
             when correct_n >= 1 and player_row.last_played = yesterday
               then player_row.current_streak + 1
             when correct_n >= 1
               then 1
             else 0
           end
         ),
         last_played = puzzle_row.puzzle_date
   where id = p_player_id;

  return jsonb_build_object(
    'ok', true,
    'correct_count', correct_n,
    'rarity_sum', rarity_sum,
    'score', total_score
  );
end;
$$;
grant execute on function finalize_game(uuid, uuid, text) to anon, authenticated;

-- 6. Re-apply mappings using new semantics
select refresh_product_categories();

-- 7. Regenerate today and tomorrow with the cleaner data
delete from puzzles where puzzle_date >= (now() at time zone 'America/New_York')::date;
select generate_puzzle_for_date((now() at time zone 'America/New_York')::date);
select generate_puzzle_for_date(((now() at time zone 'America/New_York')::date) + 1);
