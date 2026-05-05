-- =====================================================================
-- Narrow scope to hardware only.
--
-- Software answer recall is poor (Wikidata coverage gaps + missing
-- release years) and players hit too many "I know the right answer
-- but it's not in the list" moments. This script:
--
--   1. Deactivates every software product (kept in DB for history)
--   2. Deactivates software-only categories
--   3. Refreshes product/category mappings
--   4. Regenerates today + tomorrow's puzzles using the new pool
--
-- Re-runnable. After this, every puzzle is hardware-vs-hardware.
-- =====================================================================

-- 1. Deactivate all software products
update products
   set is_active = false
 where is_active and kind = 'software';

-- 2. Deactivate software-only categories
update categories set is_active = false where name in (
  'Software / App',
  'Mobile App', 'Web App', 'Desktop App',
  'Open Source',
  'Streaming Service',
  'Productivity Tool',
  'Communication / Chat',
  'Browser',
  'Developer Tool',
  'Creative Tool',
  'Social Network',
  'Cloud Storage',
  'AI / LLM Product',
  'Made by Adobe'   -- Adobe has no hardware in our seed
);

-- 3. Refresh mappings so deactivated rows drop out of every category
select refresh_product_categories();

-- 4. Wipe and regenerate today + tomorrow against the new pool.
-- (If a category we just deactivated was used in those puzzles,
-- they'd be unwinnable for some cells.)
delete from puzzles where puzzle_date >= (now() at time zone 'America/New_York')::date;
select generate_puzzle_for_date((now() at time zone 'America/New_York')::date);
select generate_puzzle_for_date(((now() at time zone 'America/New_York')::date) + 1);

-- 5. Stats — what's left active
select count(*) filter (where is_active and kind = 'hardware') as active_hardware,
       count(*) filter (where is_active and kind = 'software') as active_software_should_be_zero,
       count(*) filter (where not is_active)                   as deactivated_total
  from products;

select count(*) filter (where is_active)     as active_categories,
       count(*) filter (where not is_active) as deactivated_categories,
       array_agg(name order by name) filter (where is_active) as active_category_list
  from categories;
