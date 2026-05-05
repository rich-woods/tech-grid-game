-- =====================================================================
-- Server-side typeahead.
--
-- Run AFTER 03_functions.sql. Adds search_products() so the client never
-- has to download the full product table — instead, every keystroke
-- (debounced 200ms in game.js) calls this RPC and gets up to N matches
-- scoped to the current puzzle's 6 categories.
-- =====================================================================

create or replace function search_products(
  p_query text,
  p_puzzle_id uuid,
  p_limit int default 8
)
returns table (
  name text,
  manufacturer text,
  kind text,
  release_year int
)
language sql
stable
security definer
set search_path = public
as $$
  with cats as (
    select unnest(row_categories || col_categories) as cat_id
      from puzzles
     where id = p_puzzle_id
  ),
  pool as (
    -- Universe: products that match at least one of the puzzle's 6 categories.
    -- Includes products that satisfy a row but not the column the player is
    -- looking at — these are tempting wrong answers, which is good.
    select distinct p.id, p.name, p.manufacturer, p.kind, p.release_year, p.aliases
      from products p
      join product_categories pc on pc.product_id = p.id
     where pc.category_id in (select cat_id from cats)
       and p.is_active
  ),
  q as (select lower(trim(p_query)) as t),
  scored as (
    select pl.*,
           case
             when q.t = '' then 0
             when lower(pl.name) = q.t                                      then 1000
             when exists (
               select 1 from unnest(pl.aliases) a where lower(a) = q.t
             )                                                              then  900
             when lower(pl.name) like q.t || '%'                            then  600
             when exists (
               select 1 from unnest(pl.aliases) a where lower(a) like q.t || '%'
             )                                                              then  500
             when lower(pl.name) like '%' || q.t || '%'                     then  300
             when lower(pl.name) % q.t                                      then  150
             else 0
           end as score
      from pool pl, q
  )
  select s.name, s.manufacturer, s.kind, s.release_year
    from scored s, q
   where s.score > 0
   order by s.score desc, length(s.name) asc, s.name asc
   limit greatest(1, least(p_limit, 25));
$$;

grant execute on function search_products(text, uuid, int) to anon, authenticated;

-- Drop the old per-puzzle bulk fetch if you experimented with it; not needed.
drop function if exists get_puzzle_typeahead(uuid);
