-- =====================================================================
-- RPC functions and triggers
-- =====================================================================

-- ---------- Refresh product/category matches -------------------------
-- Re-evaluates every (product, category) pair against the rule JSON.
-- Run after editing products or categories. Idempotent.
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
    and (
      -- manufacturer match
      (
        c.rule ? 'manufacturer'
        and exists (
          select 1 from jsonb_array_elements_text(c.rule->'manufacturer') as m
          where lower(p.manufacturer) = lower(m.value)
        )
      )
      or
      -- kind match
      (c.rule ? 'kind' and p.kind = (c.rule->>'kind'))
      or
      -- year range
      (
        (c.rule ? 'year_min' or c.rule ? 'year_max')
        and p.release_year is not null
        and p.release_year >= coalesce((c.rule->>'year_min')::int, -1000000)
        and p.release_year <= coalesce((c.rule->>'year_max')::int,  1000000)
      )
      or
      -- tag match (any of)
      (
        c.rule ? 'tags'
        and exists (
          select 1 from jsonb_array_elements_text(c.rule->'tags') as t
          where t.value = any(p.tags)
        )
      )
    );
end;
$$;

-- Trigger: whenever a product or category changes, mark a refresh needed.
-- We don't refresh inside the trigger because rule edits often come in
-- batches; instead, the admin UI calls refresh_product_categories() once.

-- ---------- Generate a puzzle for a given date ----------------------
-- Algorithm:
--   1. Build a candidate pool of categories with enough products.
--   2. Pick 3 row categories at random.
--   3. From remaining candidates, keep only those that have at least
--      min_intersection products in common with EVERY chosen row.
--   4. If at least 3 such columns remain, pick 3 at random and we're done.
--   5. Else, retry with a new row pick.
-- Far more efficient than pure random selection because we never commit
-- to a column that doesn't already satisfy the rows.
create or replace function generate_puzzle_for_date(
  target_date date,
  min_intersection int default 3
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  attempts       int := 0;
  max_attempts   int := 500;
  candidate_ids  uuid[];
  row_cats       uuid[];
  col_pool       uuid[];
  picked_cols    uuid[];
  cand           uuid;
  rc             uuid;
  ok             boolean;
  cnt            int;
  new_id         uuid;
begin
  -- Skip if a puzzle already exists for this date
  select id into new_id from puzzles where puzzle_date = target_date;
  if new_id is not null then
    return new_id;
  end if;

  -- Candidate pool: categories with enough products to combine reliably
  select array_agg(c.id) into candidate_ids
    from categories c
    where c.is_active
      and (select count(*) from product_categories pc where pc.category_id = c.id) >= 6;

  if candidate_ids is null or array_length(candidate_ids, 1) < 6 then
    raise exception 'Not enough viable categories (need 6, have %)',
      coalesce(array_length(candidate_ids, 1), 0);
  end if;

  while attempts < max_attempts loop
    attempts := attempts + 1;

    -- Pick 3 row categories at random
    select array_agg(id) into row_cats
      from (select id from unnest(candidate_ids) as id order by random() limit 3) t;

    -- Build column pool: only categories whose intersection with EVERY
    -- row category has at least min_intersection products
    col_pool := array[]::uuid[];
    foreach cand in array candidate_ids loop
      if cand = any(row_cats) then continue; end if;
      ok := true;
      foreach rc in array row_cats loop
        select count(distinct pc1.product_id) into cnt
          from product_categories pc1
          join product_categories pc2 on pc1.product_id = pc2.product_id
          where pc1.category_id = cand and pc2.category_id = rc;
        if cnt < min_intersection then
          ok := false;
          exit;
        end if;
      end loop;
      if ok then col_pool := col_pool || cand; end if;
    end loop;

    -- Need at least 3 valid columns
    if array_length(col_pool, 1) >= 3 then
      select array_agg(id) into picked_cols
        from (select unnest(col_pool) as id order by random() limit 3) t;

      insert into puzzles (puzzle_date, row_categories, col_categories, status)
      values (target_date, row_cats, picked_cols, 'published')
      returning id into new_id;
      return new_id;
    end if;
  end loop;

  raise exception 'Failed to generate a valid puzzle after % attempts (try lowering min_intersection or adding more products)', max_attempts;
end;
$$;

-- ---------- Submit a single guess + return rarity -------------------
-- Returns: { is_correct, product, rarity, percent_picked }
-- rarity = 100 - round(100 * pickers_for_this_product / total_correct_for_cell)
-- (so unique answers score 100, the most popular answer scores low)
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

  -- Ensure the player row exists (guesses.player_id has an FK to players.id).
  -- The display name and stats stay null until finalize_game runs.
  insert into players (id) values (p_player_id) on conflict (id) do nothing;

  -- Reject if the player has already guessed this cell
  if exists (
    select 1 from guesses
     where puzzle_id = p_puzzle_id and player_id = p_player_id
       and row_idx = p_row_idx and col_idx = p_col_idx
  ) then
    return jsonb_build_object('is_correct', false, 'reason', 'already_guessed');
  end if;

  select * into puzzle_row from puzzles where id = p_puzzle_id;
  if not found then
    return jsonb_build_object('is_correct', false, 'reason', 'unknown_puzzle');
  end if;

  row_cat_id := puzzle_row.row_categories[p_row_idx + 1];
  col_cat_id := puzzle_row.col_categories[p_col_idx + 1];

  -- Find the product by name or alias (case-insensitive)
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
    -- Record the incorrect guess so we can still occupy the cell
    insert into guesses (puzzle_id, player_id, row_idx, col_idx, raw_text, is_correct)
    values (p_puzzle_id, p_player_id, p_row_idx, p_col_idx, p_raw_text, false);
    return jsonb_build_object('is_correct', false, 'reason', 'unknown_product');
  end if;

  -- Verify the product satisfies BOTH categories
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

  -- Correct! Record it.
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

-- ---------- Finalize a game (call when player gives up or hits 9) ---
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
  player_row  players%rowtype;
  puzzle_row  puzzles%rowtype;
  yesterday   date;
begin
  select * into puzzle_row from puzzles where id = p_puzzle_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_puzzle');
  end if;

  -- Upsert player row
  insert into players (id, display_name)
  values (p_player_id, p_display_name)
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, players.display_name);

  -- Sum cell rarity for this player on this puzzle.
  -- Per cell: rarity = 100 - round(100 * pickers_of_same_product / total_correct_pickers)
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

  -- Persist game result (upsert)
  insert into game_results (puzzle_id, player_id, correct_count, rarity_score)
  values (p_puzzle_id, p_player_id, correct_n, rarity_sum)
  on conflict (puzzle_id, player_id) do update
    set correct_count = excluded.correct_count,
        rarity_score  = excluded.rarity_score,
        completed_at  = now();

  -- Update streak / aggregate stats
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
    'rarity_score', rarity_sum
  );
end;
$$;

-- ---------- Read helpers --------------------------------------------

-- Today's published puzzle plus its category labels
create or replace function get_today_puzzle()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select * from puzzles
     where status = 'published'
       and puzzle_date <= (now() at time zone 'America/New_York')::date
     order by puzzle_date desc
     limit 1
  ),
  rows_c as (
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by ord) as items
    from p,
         lateral unnest(p.row_categories) with ordinality as r(id, ord)
         join categories c on c.id = r.id
  ),
  cols_c as (
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by ord) as items
    from p,
         lateral unnest(p.col_categories) with ordinality as r(id, ord)
         join categories c on c.id = r.id
  )
  select jsonb_build_object(
    'id', p.id,
    'date', p.puzzle_date,
    'rows', coalesce((select items from rows_c), '[]'::jsonb),
    'cols', coalesce((select items from cols_c), '[]'::jsonb)
  ) from p;
$$;

-- Leaderboard for a given puzzle (top N by rarity_score then correct_count)
create or replace function get_leaderboard(p_puzzle_id uuid, p_limit int default 50)
returns table (
  display_name  text,
  correct_count int,
  rarity_score  int,
  completed_at  timestamptz,
  current_streak int
)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(pl.display_name, ''), 'Anonymous'),
         gr.correct_count,
         gr.rarity_score,
         gr.completed_at,
         pl.current_streak
    from game_results gr
    join players pl on pl.id = gr.player_id
   where gr.puzzle_id = p_puzzle_id
   order by gr.rarity_score desc, gr.correct_count desc, gr.completed_at asc
   limit p_limit;
$$;

-- Per-cell rarity breakdown (for the "what others picked" reveal)
create or replace function get_cell_breakdown(p_puzzle_id uuid, p_row int, p_col int)
returns table (
  product_id   uuid,
  product_name text,
  pick_count   int,
  pick_percent int
)
language sql
stable
security definer
set search_path = public
as $$
  with totals as (
    select count(*)::int as t from guesses
     where puzzle_id = p_puzzle_id and row_idx = p_row and col_idx = p_col and is_correct
  )
  select g.product_id,
         pr.name,
         count(*)::int as pick_count,
         case when (select t from totals) = 0 then 0
              else round(100.0 * count(*) / (select t from totals))::int
         end as pick_percent
    from guesses g
    join products pr on pr.id = g.product_id
   where g.puzzle_id = p_puzzle_id and g.row_idx = p_row and g.col_idx = p_col and g.is_correct
   group by g.product_id, pr.name
   order by pick_count desc;
$$;

-- Allow anon role to call our RPCs
grant execute on function get_today_puzzle()                    to anon, authenticated;
grant execute on function submit_guess(uuid, uuid, int, int, text) to anon, authenticated;
grant execute on function finalize_game(uuid, uuid, text)       to anon, authenticated;
grant execute on function get_leaderboard(uuid, int)            to anon, authenticated;
grant execute on function get_cell_breakdown(uuid, int, int)    to anon, authenticated;
-- generate_puzzle_for_date and refresh_product_categories are admin-only.
-- Revoke from public + anon; service_role bypasses revokes by design.
revoke execute on function generate_puzzle_for_date(date, int) from public, anon;
revoke execute on function refresh_product_categories()        from public, anon;
