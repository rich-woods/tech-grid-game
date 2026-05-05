-- =====================================================================
-- Daily puzzle generation cron
--
-- pg_cron uses UTC. To target 9:00 AM America/New_York (which shifts
-- between UTC-5 EST and UTC-4 EDT), we run hourly and only act when
-- the local clock is 9. This avoids fragile DST math and incurs
-- negligible overhead.
-- =====================================================================

-- Refresh product/category mappings once now so seed data is usable
select refresh_product_categories();

-- Backfill: ensure today and tomorrow have puzzles
select generate_puzzle_for_date((now() at time zone 'America/New_York')::date);
select generate_puzzle_for_date(((now() at time zone 'America/New_York')::date) + 1);

-- Schedule: every hour, generate tomorrow's puzzle if it's 9 AM ET.
-- We always generate one day ahead so the puzzle is ready when the
-- clock rolls over to the next day at 9 AM ET.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'tech-grid-daily') then
    perform cron.unschedule('tech-grid-daily');
  end if;
end $$;

select cron.schedule(
  'tech-grid-daily',
  '0 * * * *',
  $$
  select case
    when extract(hour from now() at time zone 'America/New_York') = 9
      then generate_puzzle_for_date(((now() at time zone 'America/New_York')::date) + 1)
    else null
  end;
  $$
);
