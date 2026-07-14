create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Tokyo',
  day_start_time time not null default '07:00',
  day_end_time time not null default '23:00',
  default_focus_minutes integer not null default 60 check (default_focus_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (day_start_time < day_end_time)
);

create table public.categories (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);

create table public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'inbox' check (status in ('inbox','planned','in_progress','completed','cancelled')),
  priority smallint not null default 3 check (priority between 1 and 5),
  due_at timestamptz,
  estimated_minutes integer not null check (estimated_minutes > 0),
  remaining_minutes integer check (remaining_minutes >= 0),
  splittable boolean not null default true,
  minimum_block_minutes integer not null default 25 check (minimum_block_minutes > 0),
  category_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id)
);

create table public.routines (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  frequency_type text not null check (frequency_type in ('daily','weekdays')),
  weekdays smallint[] not null default '{}',
  estimated_minutes integer not null check (estimated_minutes > 0),
  priority smallint not null default 3 check (priority between 1 and 5),
  category_id uuid,
  available_start_time time,
  available_end_time time,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  check ((frequency_type = 'daily' and cardinality(weekdays) = 0) or (frequency_type = 'weekdays' and cardinality(weekdays) > 0)),
  check ((available_start_time is null and available_end_time is null) or (available_start_time is not null and available_end_time is not null and available_start_time < available_end_time)),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id)
);

create table public.routine_completions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null,
  target_date date not null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (routine_id, target_date),
  foreign key (routine_id, user_id) references public.routines(id, user_id) on delete cascade
);

create index tasks_user_due_at_idx on public.tasks(user_id, due_at);
create index tasks_user_status_idx on public.tasks(user_id, status);
create index tasks_user_updated_at_idx on public.tasks(user_id, updated_at desc);
create index routines_user_active_idx on public.routines(user_id, is_active);
create index routine_completions_user_date_idx on public.routine_completions(user_id, target_date);
create index categories_user_name_idx on public.categories(user_id, name);

create trigger user_profiles_set_updated_at before update on public.user_profiles for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger routines_set_updated_at before update on public.routines for each row execute function public.set_updated_at();
create trigger routine_completions_set_updated_at before update on public.routine_completions for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

alter table public.user_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.tasks enable row level security;
alter table public.routines enable row level security;
alter table public.routine_completions enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['user_profiles','categories','tasks','routines','routine_completions'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', table_name || '_insert_own', table_name);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_update_own', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', table_name || '_delete_own', table_name);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.user_profiles, public.categories, public.tasks, public.routines, public.routine_completions to authenticated;
revoke all on public.user_profiles, public.categories, public.tasks, public.routines, public.routine_completions from anon;
