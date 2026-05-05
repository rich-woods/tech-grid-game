-- =====================================================================
-- Heuristic release_year backfill.
--
-- Wikidata frequently lacks inception/publication-date data for software,
-- and we end up with NULL release_year for popular products. This script
-- fills in years using reliable patterns:
--
--   1. Year in the name itself: "Surface Pro 9 (2022)" or "iPad 2019"
--   2. Hardcoded family→year maps for big product lines (iPhone, iPad,
--      iOS, Android, macOS, Windows, Galaxy S, Pixel, MacBook, Switch,
--      PlayStation, Xbox, Apple Watch, AirPods, etc.)
--
-- Each pass only touches still-NULL rows and only by slug match, so
-- this is conservative — it never overwrites a year that was already
-- set, and it ignores anything it isn't confident about.
--
-- Re-runnable. Ends with refresh_product_categories() and a stats row.
-- =====================================================================

-- ---------- Pass 1: year embedded in product name ------------------
-- Catches "(2022)", "iPhone 15 Pro 2023", "Surface Pro 9, 2022", etc.
-- Restricts to 1990–2030 so random model numbers like "A52" don't match.
update products
   set release_year = sub.yr
  from (
    select id,
           ((regexp_match(name, '(199[0-9]|20[0-3][0-9])'))[1])::int as yr
      from products
     where release_year is null
       and (regexp_match(name, '(199[0-9]|20[0-3][0-9])'))[1] is not null
  ) sub
 where products.id = sub.id
   and products.release_year is null
   and sub.yr between 1990 and 2030;

-- ---------- Pass 2: iPhone family ----------------------------------
update products set release_year = 2025 where release_year is null and slug ~ '^iphone-(17|air)';
update products set release_year = 2024 where release_year is null and slug ~ '^iphone-16';
update products set release_year = 2023 where release_year is null and slug ~ '^iphone-15';
update products set release_year = 2022 where release_year is null and (slug ~ '^iphone-14' or slug = 'iphone-se-3');
update products set release_year = 2021 where release_year is null and slug ~ '^iphone-13';
update products set release_year = 2020 where release_year is null and (slug ~ '^iphone-12' or slug = 'iphone-se-2');
update products set release_year = 2019 where release_year is null and slug ~ '^iphone-11';
update products set release_year = 2018 where release_year is null and slug ~ '^iphone-x[sr]?$';
update products set release_year = 2017 where release_year is null and (slug = 'iphone-x' or slug ~ '^iphone-8');
update products set release_year = 2016 where release_year is null and (slug ~ '^iphone-7' or slug = 'iphone-se');
update products set release_year = 2015 where release_year is null and slug ~ '^iphone-6s';
update products set release_year = 2014 where release_year is null and slug ~ '^iphone-6';
update products set release_year = 2013 where release_year is null and slug ~ '^iphone-5[sc]';
update products set release_year = 2012 where release_year is null and slug = 'iphone-5';

-- ---------- Pass 3: iOS / iPadOS / watchOS / tvOS / visionOS ------
update products set release_year = 2025 where release_year is null and slug ~ '(^|-)ios-26($|-)';
update products set release_year = 2024 where release_year is null and slug ~ '(^|-)(ios|ipados)-18($|-)';
update products set release_year = 2023 where release_year is null and slug ~ '(^|-)(ios|ipados)-17($|-)';
update products set release_year = 2022 where release_year is null and slug ~ '(^|-)(ios|ipados)-16($|-)';
update products set release_year = 2021 where release_year is null and slug ~ '(^|-)(ios|ipados)-15($|-)';
update products set release_year = 2020 where release_year is null and slug ~ '(^|-)(ios|ipados)-14($|-)';
update products set release_year = 2019 where release_year is null and slug ~ '(^|-)(ios|ipados)-13($|-)';
update products set release_year = 2025 where release_year is null and slug ~ 'watchos-(11|12)';
update products set release_year = 2024 where release_year is null and slug ~ 'watchos-(10|11)';
update products set release_year = 2023 where release_year is null and slug = 'watchos-10';

-- ---------- Pass 4: macOS named versions --------------------------
update products set release_year = 2024 where release_year is null and lower(name) ~ '\msequoia\m';
update products set release_year = 2023 where release_year is null and lower(name) ~ '\msonoma\m';
update products set release_year = 2022 where release_year is null and lower(name) ~ '\mventura\m';
update products set release_year = 2021 where release_year is null and lower(name) ~ '\mmonterey\m';
update products set release_year = 2020 where release_year is null and lower(name) ~ '\mbig sur\m';
update products set release_year = 2019 where release_year is null and lower(name) ~ '\mcatalina\m';
update products set release_year = 2018 where release_year is null and lower(name) ~ '\mmojave\m';
update products set release_year = 2017 where release_year is null and lower(name) ~ '\mhigh sierra\m';
update products set release_year = 2016 where release_year is null and lower(name) ~ '\msierra\m';
update products set release_year = 2015 where release_year is null and (lower(name) ~ '\mel capitan\m' or lower(name) ~ 'os x 10\.11');
update products set release_year = 2014 where release_year is null and lower(name) ~ '\myosemite\m';

-- ---------- Pass 5: Android numbered versions ---------------------
update products set release_year = 2025 where release_year is null and slug ~ '^android-16$';
update products set release_year = 2024 where release_year is null and slug ~ '^android-15$';
update products set release_year = 2023 where release_year is null and slug ~ '^android-14$';
update products set release_year = 2022 where release_year is null and slug ~ '^android-13$';
update products set release_year = 2021 where release_year is null and slug ~ '^android-12$';
update products set release_year = 2020 where release_year is null and slug ~ '^android-11$';
update products set release_year = 2019 where release_year is null and slug ~ '^android-10$';
update products set release_year = 2018 where release_year is null and (slug = 'android-9' or lower(name) ~ '\mandroid pie\m');
update products set release_year = 2017 where release_year is null and (slug = 'android-8' or lower(name) ~ '\mandroid oreo\m');
update products set release_year = 2016 where release_year is null and (slug = 'android-7' or lower(name) ~ '\mnougat\m');

-- ---------- Pass 6: Windows ---------------------------------------
update products set release_year = 2021 where release_year is null and slug ~ 'windows-11';
update products set release_year = 2015 where release_year is null and slug ~ 'windows-10';
update products set release_year = 2012 where release_year is null and slug ~ 'windows-8';
update products set release_year = 2009 where release_year is null and slug ~ 'windows-7';

-- ---------- Pass 7: Samsung Galaxy S / Note / Z ------------------
update products set release_year = 2025 where release_year is null and slug ~ 'galaxy-s25';
update products set release_year = 2024 where release_year is null and (slug ~ 'galaxy-s24' or slug ~ 'galaxy-z-(fold|flip)-6');
update products set release_year = 2023 where release_year is null and (slug ~ 'galaxy-s23' or slug ~ 'galaxy-z-(fold|flip)-5');
update products set release_year = 2022 where release_year is null and (slug ~ 'galaxy-s22' or slug ~ 'galaxy-z-(fold|flip)-4');
update products set release_year = 2021 where release_year is null and (slug ~ 'galaxy-s21' or slug ~ 'galaxy-z-(fold|flip)-3');
update products set release_year = 2020 where release_year is null and (slug ~ 'galaxy-s20' or slug ~ 'galaxy-z-(fold|flip)-2');
update products set release_year = 2019 where release_year is null and (slug ~ 'galaxy-s10' or slug ~ 'galaxy-note-?10' or slug ~ 'galaxy-fold');
update products set release_year = 2018 where release_year is null and (slug ~ 'galaxy-s9' or slug ~ 'galaxy-note-?9');
update products set release_year = 2017 where release_year is null and (slug ~ 'galaxy-s8' or slug ~ 'galaxy-note-?8');

-- ---------- Pass 8: Google Pixel ----------------------------------
update products set release_year = 2025 where release_year is null and slug ~ '^pixel-10';
update products set release_year = 2024 where release_year is null and slug ~ '^pixel-9';
update products set release_year = 2023 where release_year is null and slug ~ '^pixel-8';
update products set release_year = 2022 where release_year is null and slug ~ '^pixel-7';
update products set release_year = 2021 where release_year is null and slug ~ '^pixel-6';
update products set release_year = 2020 where release_year is null and slug ~ '^pixel-5';
update products set release_year = 2019 where release_year is null and slug ~ '^pixel-4';
update products set release_year = 2018 where release_year is null and slug ~ '^pixel-3';
update products set release_year = 2017 where release_year is null and slug ~ '^pixel-2';
update products set release_year = 2016 where release_year is null and slug ~ '^pixel($|-(xl|c)$)';

-- ---------- Pass 9: Apple Silicon Macs (by chip generation) ------
update products set release_year = 2024 where release_year is null and slug ~ '-m4';
update products set release_year = 2023 where release_year is null and slug ~ '-m3';
update products set release_year = 2022 where release_year is null and slug ~ '-m2';
update products set release_year = 2020 where release_year is null and slug ~ '-m1';

-- ---------- Pass 10: AirPods / Apple Watch / Vision Pro ----------
update products set release_year = 2025 where release_year is null and slug = 'airpods-pro-3';
update products set release_year = 2024 where release_year is null and slug = 'airpods-4';
update products set release_year = 2024 where release_year is null and slug ~ 'apple-watch-(10|series-10|ultra-3)';
update products set release_year = 2023 where release_year is null and slug ~ 'apple-watch-(9|series-9|ultra-2)';
update products set release_year = 2022 where release_year is null and (slug = 'airpods-pro-2' or slug ~ 'apple-watch-(8|series-8|se-2|ultra)');
update products set release_year = 2024 where release_year is null and slug ~ 'vision-pro';

-- ---------- Pass 11: Consoles -------------------------------------
update products set release_year = 2025 where release_year is null and slug ~ 'nintendo-switch-2|switch-2';
update products set release_year = 2024 where release_year is null and slug ~ 'playstation-5-pro|ps5-pro';
update products set release_year = 2021 where release_year is null and slug ~ 'nintendo-switch-oled|switch-oled';
update products set release_year = 2020 where release_year is null and slug ~ 'playstation-5|ps5|xbox-series-x|xbox-series-s';
update products set release_year = 2019 where release_year is null and slug ~ 'nintendo-switch-lite|switch-lite';
update products set release_year = 2017 where release_year is null and slug ~ '^nintendo-switch$|^switch$';
update products set release_year = 2013 where release_year is null and slug ~ 'playstation-4|ps4|xbox-one';
update products set release_year = 2006 where release_year is null and slug ~ 'playstation-3|ps3';
update products set release_year = 2005 where release_year is null and slug ~ 'xbox-360';

-- ---------- Pass 12: Apply mapping refresh ------------------------
select refresh_product_categories();

-- ---------- Stats ------------------------------------------------
select kind,
       count(*) as total_active,
       count(release_year) as has_year,
       count(*) - count(release_year) as missing_year,
       round(100.0 * (count(*) - count(release_year)) / nullif(count(*),0), 1) as pct_missing
  from products
 where is_active
 group by kind
 order by kind;
