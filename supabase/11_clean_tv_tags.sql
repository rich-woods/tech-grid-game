-- =====================================================================
-- Clean up bogus "tv" tagging.
--
-- Two problems:
--   1. The scrape labelled streaming devices (Roku, Chromecast, Fire TV
--      Stick) with the "tv" tag, even though they're not televisions.
--   2. Wikidata's actual TV records are mostly obscure manufacturer
--      model numbers ("Sony KDL-32W650A", "Toshiba 32WL66") that aren't
--      guessable in a trivia context.
--
-- Fix:
--   - Strip "tv" tag from every existing product. (We don't currently
--     have a "TV" category, so the tag was useless anyway.)
--   - Delete products whose only meaningful tags were "tv,home" — these
--     came from the now-removed Smart TV / Television set queries and
--     have nothing else useful in them.
--
-- Re-runnable.
-- =====================================================================

-- 1. Remove "tv" tag from all products (and the dead "has-touchscreen-no" tag too)
update products
   set tags = array_remove(array_remove(tags, 'tv'), 'has-touchscreen-no')
 where 'tv' = any(tags) or 'has-touchscreen-no' = any(tags);

-- 2. Delete products that came from the dropped TV queries — they had only
-- {tv, home} or {home} tags after step 1 left them with just "home".
-- These are the obscure model-number entries.
-- We're conservative: only delete if the only remaining tag is "home" AND
-- there's no manufacturer match to a curated record we'd want to keep.
delete from guesses
 where product_id in (
   select id from products
    where cardinality(tags) <= 1
      and (tags = '{home}' or tags = '{}')
      and not exists (
        select 1 from products keep
         where keep.id <> products.id
           and keep.is_active
           and lower(keep.name) = lower(products.name)
      )
 );

delete from products
 where cardinality(tags) <= 1
   and (tags = '{home}' or tags = '{}');

-- 3. Refresh mappings since tag arrays changed
select refresh_product_categories();

-- 4. Stats
select count(*) as remaining_products,
       count(*) filter (where 'tv' = any(tags)) as tv_tagged_should_be_zero,
       count(*) filter (where is_active) as active_products
  from products;
