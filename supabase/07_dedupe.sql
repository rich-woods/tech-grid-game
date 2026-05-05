-- =====================================================================
-- Deactivate Wikidata duplicates of curated products.
--
-- Wikidata often stores the canonical label as "<Manufacturer> <Product>"
-- (e.g. "Microsoft OneDrive" while we already have "OneDrive" from
-- the hand-curated seed). This script flags those longer names as
-- inactive — they stay in the table for history but stop showing up
-- in typeahead and don't satisfy any category.
--
-- Re-runnable. Conservative: only flags when a SHORTER product with
-- the same manufacturer exists.
-- =====================================================================

with dupes as (
  select dup.id
    from products dup
    join products keep
      on keep.is_active
     and keep.id <> dup.id
     and keep.manufacturer is not null
     and keep.manufacturer = dup.manufacturer
     and lower(dup.name) = lower(keep.manufacturer || ' ' || keep.name)
   where dup.is_active
)
update products set is_active = false where id in (select id from dupes);

-- Also catch a common variant: "Apple iPhone 15 Pro" vs "iPhone 15 Pro"
-- where Wikidata prefixed even though the curated record has the same kind.
-- Same conservative rule but case-insensitive substring at the start.
with dupes as (
  select dup.id
    from products dup
    join products keep
      on keep.is_active
     and keep.id <> dup.id
     and keep.manufacturer is not null
     and keep.manufacturer = dup.manufacturer
     and length(dup.name) > length(keep.name)
     and lower(dup.name) = lower(keep.manufacturer) || ' ' || lower(keep.name)
   where dup.is_active
)
update products set is_active = false where id in (select id from dupes);

-- Refresh category mappings so the deactivated products vanish from puzzles
select refresh_product_categories();

-- Sanity check — see how many got deactivated
select count(*) filter (where is_active)     as active_products,
       count(*) filter (where not is_active) as deactivated_products
  from products;
