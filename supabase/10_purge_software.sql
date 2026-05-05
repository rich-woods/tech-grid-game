-- =====================================================================
-- Permanently delete software products and software-only categories.
--
-- Run AFTER 09_hardware_only.sql has flagged everything inactive.
-- This is the irreversible step — once these rows are gone, restoring
-- means re-running 02_seed.sql / 02b_seed_wikidata.sql / 02c_seed_recent.sql.
--
-- Order matters because of foreign keys:
--   1. Delete guesses pointing to software products (FK with no cascade)
--   2. Delete the products themselves (product_categories cascades)
--   3. Delete the software-only categories
--   4. Refresh mappings, report counts
--
-- Past puzzles whose row_categories[] / col_categories[] arrays reference
-- the deleted category UUIDs are left intact: those arrays are not foreign
-- keys, so the dangling refs don't block deletion. Old puzzles still hold
-- their leaderboard history (game_results) but won't render fully if ever
-- replayed via admin — that's acceptable since they're past dates.
-- =====================================================================

-- 1. Clear guess history that points at software products
delete from guesses
 where product_id in (select id from products where kind = 'software');

-- 2. Delete software products (product_categories cascades from products)
delete from products where kind = 'software';

-- 3. Delete software-only categories
delete from categories where name in (
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
  'Made by Adobe'
);

-- 4. Refresh product/category mappings to drop any stale rows
select refresh_product_categories();

-- 5. Stats — what remains
select count(*) as total_products,
       count(*) filter (where is_active) as active_products,
       count(*) filter (where kind = 'software') as software_should_be_zero
  from products;

select count(*) as total_categories,
       count(*) filter (where is_active) as active_categories
  from categories;
