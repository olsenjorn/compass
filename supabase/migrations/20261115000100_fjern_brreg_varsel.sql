-- Brreg-varslingen er tatt ut av appen: stopp den nattlige sjekken og fjern tabell og funksjon.
select cron.unschedule(jobname) from cron.job where jobname in ('brreg-sjekk', 'brreg-forste');
drop function if exists public.brreg_sjekk(int);
drop function if exists public.brreg_sjekk();
drop table if exists public.brreg_status;
