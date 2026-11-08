-- Tofaktor (TOTP via Microsoft/Google Authenticator).
-- app_innstilling.krev_mfa = false: alle kan sette opp, men innlogging med bare passord virker fortsatt.
-- Når alle har satt opp: update public.app_innstilling set krev_mfa = true;
-- Da krever databasen en tofaktor-verifisert økt (aal2) for ALLE tabeller, også i serverfunksjonene.
create table if not exists public.app_innstilling (
  id        int primary key default 1 check (id = 1),
  krev_mfa  boolean not null default false
);
insert into public.app_innstilling (id) values (1) on conflict (id) do nothing;
alter table public.app_innstilling enable row level security;
drop policy if exists "innst: lese" on public.app_innstilling;
create policy "innst: lese" on public.app_innstilling for select to authenticated using (true);
revoke all on public.app_innstilling from anon;
grant select on public.app_innstilling to authenticated;

create or replace function public.mfa_ok() returns boolean
language sql stable security invoker set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not coalesce((select i.krev_mfa from public.app_innstilling i where i.id = 1), false)
$$;
revoke execute on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;

-- Restriktiv regel på alle tabeller med data: kommer i tillegg til (AND) de vanlige reglene.
do $$
declare t text;
begin
  foreach t in array array['tilgang','kunder','sted_rettelse','kunde_adresse','kunde_info','ruteplaner','prospekter'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "krev tofaktor" on public.%I', t);
      execute format('create policy "krev tofaktor" on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
    end if;
  end loop;
end $$;
