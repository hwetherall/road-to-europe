create or replace function public.prune_old_deep_analysis_reports(retention_days integer default 30)
returns integer
language plpgsql
as $$
declare
  deleted_count integer;
begin
  delete from public.deep_analysis_reports
  where updated_at < now() - make_interval(days => retention_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

do $$
begin
  create extension if not exists pg_cron;
exception
  when insufficient_privilege then
    raise notice 'Skipping pg_cron extension setup (insufficient privilege).';
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (
      select 1
      from cron.job
      where jobname = 'deep-analysis-cache-prune-daily'
    ) then
      perform cron.schedule(
        'deep-analysis-cache-prune-daily',
        '15 3 * * *',
        'select public.prune_old_deep_analysis_reports(30);'
      );
    end if;
  end if;
exception
  when undefined_table then
    raise notice 'Skipping cron job creation (cron.job not available).';
  when insufficient_privilege then
    raise notice 'Skipping cron job creation (insufficient privilege).';
end;
$$;
