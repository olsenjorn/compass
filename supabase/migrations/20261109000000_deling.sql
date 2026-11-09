-- Deling av ruter med kolleger, og kollegaliste til delingsvalget.

-- Kollegaliste (navn + e-post) for innloggede med tilgang. tilgang-tabellen selv viser fortsatt bare egen rad.
create or replace function public.kolleger()
returns table (epost text, navn text)
language sql stable security definer set search_path = ''
as $$
  select t.epost, t.navn from public.tilgang t
  where exists (select 1 from public.tilgang s where s.epost = lower((select auth.jwt() ->> 'email')))
    and public.mfa_ok()
  order by t.navn
$$;
revoke execute on function public.kolleger() from public, anon;
grant execute on function public.kolleger() to authenticated;

alter table public.ruteplaner add column if not exists delt_med text[] not null default '{}';

-- Lese: egne, delt med meg, eller som admin/leder
drop policy if exists "ruter: lese egne eller som leder" on public.ruteplaner;
drop policy if exists "ruter: lese egne, delte eller som leder" on public.ruteplaner;
create policy "ruter: lese egne, delte eller som leder" on public.ruteplaner
  for select to authenticated
  using (
    laget_av = lower((select auth.jwt() ->> 'email'))
    or lower((select auth.jwt() ->> 'email')) = any (delt_med)
    or exists (select 1 from public.tilgang t
               where t.epost = lower((select auth.jwt() ->> 'email'))
                 and t.rolle in ('admin','leder'))
  );

-- Endre: eier eller den ruta er delt med
drop policy if exists "ruter: endre egne" on public.ruteplaner;
drop policy if exists "ruter: endre egne eller delte" on public.ruteplaner;
create policy "ruter: endre egne eller delte" on public.ruteplaner
  for update to authenticated
  using (laget_av = lower((select auth.jwt() ->> 'email')) or lower((select auth.jwt() ->> 'email')) = any (delt_med))
  with check (laget_av = lower((select auth.jwt() ->> 'email')) or lower((select auth.jwt() ->> 'email')) = any (delt_med));

-- Eieren kan ikke endres av andre
create or replace function public.ruteplaner_behold_eier() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.laget_av := old.laget_av;
  return new;
end $$;
drop trigger if exists ruteplaner_behold_eier on public.ruteplaner;
create trigger ruteplaner_behold_eier before update on public.ruteplaner
  for each row execute function public.ruteplaner_behold_eier();
revoke execute on function public.ruteplaner_behold_eier() from public, anon, authenticated;
