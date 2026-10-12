-- Esquema de Journal Trading en Supabase.
--
-- Se corre una sola vez en el SQL Editor del proyecto (Supabase → SQL Editor →
-- New query → pegar todo → Run). Se puede volver a correr sin romper nada.
--
-- Tablas:
--   profiles       Datos del usuario y fin de la prueba gratis. Se crea sola al
--                  registrarse (trigger on_auth_user_created).
--   subscriptions  Plan Pro. Solo la escribe el servidor (webhook de Paddle con la
--                  service role key); el usuario solo la puede leer.
--   journals       El journal de cada usuario como un único JSON, igual que hoy en
--                  localStorage.
--
-- Seguridad: RLS activado en todas. Cada usuario ve y edita solo lo suyo, y no
-- puede tocar ni la fecha de fin de la prueba ni su suscripción.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null default '' check (char_length(name) <= 40),
  avatar_color  text check (avatar_color in ('green', 'blue', 'violet', 'amber', 'rose', 'slate')),
  onboarded     boolean not null default false,
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: leer el propio" on public.profiles;
create policy "profiles: leer el propio" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "profiles: editar el propio" on public.profiles;
create policy "profiles: editar el propio" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- El usuario solo puede cambiar estas columnas: trial_ends_at queda fuera de su alcance.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, avatar_color, onboarded) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  status                 text not null check (status in ('active', 'trialing', 'past_due', 'paused', 'canceled')),
  billing                text check (billing in ('monthly', 'annual')),
  current_period_ends_at timestamptz,
  paddle_customer_id     text,
  paddle_subscription_id text unique,
  updated_at             timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions: leer la propia" on public.subscriptions;
create policy "subscriptions: leer la propia" on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- journals
-- ---------------------------------------------------------------------------
create table if not exists public.journals (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  data           jsonb not null default '{}'::jsonb,
  schema_version integer not null default 0,
  updated_at     timestamptz not null default now(),
  -- Las capturas van a Storage, no adentro del JSON: con esto alcanza de sobra.
  constraint journals_data_size check (pg_column_size(data) <= 5 * 1024 * 1024)
);

alter table public.journals enable row level security;

-- ---------------------------------------------------------------------------
-- Acceso: Pro activo o prueba vigente
-- ---------------------------------------------------------------------------
-- Pro cuenta mientras la suscripción esté al día, y también si la canceló pero
-- todavía no terminó el período que ya pagó.
create or replace function public.has_access(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid
      and (s.status in ('active', 'trialing', 'past_due')
           or (s.status = 'canceled' and s.current_period_ends_at > now()))
  ) or exists (
    select 1 from public.profiles p where p.id = uid and p.trial_ends_at > now()
  );
$$;

revoke execute on function public.has_access(uuid) from public, anon;
grant execute on function public.has_access(uuid) to authenticated;

-- Leer el journal se puede siempre (para exportarlo aunque la prueba haya vencido);
-- escribirlo, solo con acceso.
drop policy if exists "journals: leer el propio" on public.journals;
create policy "journals: leer el propio" on public.journals
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "journals: crear el propio" on public.journals;
create policy "journals: crear el propio" on public.journals
  for insert to authenticated with check (user_id = (select auth.uid()) and public.has_access());

drop policy if exists "journals: editar el propio" on public.journals;
create policy "journals: editar el propio" on public.journals
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.has_access());

revoke all on public.journals from anon, authenticated;
grant select, insert, update on public.journals to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

drop trigger if exists journals_touch on public.journals;
create trigger journals_touch before update on public.journals
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Perfil al registrarse
-- ---------------------------------------------------------------------------
-- Toma el nombre que mandó el formulario (o el de Google) y arranca la prueba de
-- 7 días desde el servidor, así no se puede alargar desde el navegador.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    left(trim(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', '')), 40)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
