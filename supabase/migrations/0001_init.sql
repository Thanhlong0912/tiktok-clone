-- TikTok clone schema.
-- Run this once in the Supabase SQL editor (or via `supabase db push`).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references auth.users(id) on delete cascade,
    name text not null,
    image text not null default '',
    bio text not null default '',
    created_at timestamptz not null default now()
);

create table if not exists public.posts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    text text not null default '',
    -- Either a bare storage object path (video posts) or the encoded
    -- "images:<id>,<id>|audio:<id>" value used by image posts.
    video_url text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.comments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    post_id uuid not null references public.posts(id) on delete cascade,
    text text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.likes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    post_id uuid not null references public.posts(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (user_id, post_id)
);

create table if not exists public.follows (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    to_user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (user_id, to_user_id)
);

create table if not exists public.saves (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    post_id uuid not null references public.posts(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (user_id, post_id)
);

create table if not exists public.reposts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    post_id uuid not null references public.posts(id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (user_id, post_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists posts_user_id_idx on public.posts (user_id);
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists comments_post_id_idx on public.comments (post_id);
create index if not exists comments_user_id_idx on public.comments (user_id);
create index if not exists likes_post_id_idx on public.likes (post_id);
create index if not exists likes_user_id_idx on public.likes (user_id);
create index if not exists follows_user_id_idx on public.follows (user_id);
create index if not exists follows_to_user_id_idx on public.follows (to_user_id);
create index if not exists saves_user_id_idx on public.saves (user_id);
create index if not exists saves_post_id_idx on public.saves (post_id);
create index if not exists reposts_user_id_idx on public.reposts (user_id);
create index if not exists reposts_post_id_idx on public.reposts (post_id);
-- Supports the case insensitive name search used by profile search / @mentions.
create index if not exists profiles_name_idx on public.profiles (lower(name));

-- ---------------------------------------------------------------------------
-- Row level security
-- Everything is publicly readable (the feed works logged out); writes are
-- restricted to rows the authenticated user owns.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.follows enable row level security;
alter table public.saves enable row level security;
alter table public.reposts enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array['profiles', 'posts', 'comments', 'likes', 'follows', 'saves', 'reposts']
    loop
        execute format('drop policy if exists "%s_select_all" on public.%I', t, t);
        execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
        execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
        execute format('drop policy if exists "%s_delete_own" on public.%I', t, t);

        execute format(
            'create policy "%s_select_all" on public.%I for select using (true)', t, t);
        execute format(
            'create policy "%s_insert_own" on public.%I for insert with check (auth.uid() = user_id)', t, t);
        execute format(
            'create policy "%s_update_own" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
        execute format(
            'create policy "%s_delete_own" on public.%I for delete using (auth.uid() = user_id)', t, t);
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile is created automatically for every new auth user, so registration
-- works no matter how email confirmation is configured.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (user_id, name, image, bio)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
        -- Must match NEXT_PUBLIC_PLACEHOLDER_DEAFULT_IMAGE_ID in .env.
        'placeholder-avatar.png',
        ''
    )
    on conflict (user_id) do nothing;
    return new;
end;
$$;

-- Only the trigger below should ever call this. Revoke the default public
-- EXECUTE grant so a SECURITY DEFINER function isn't reachable as an RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Storage: one public bucket for videos, post images, post audio and avatars.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

-- Policies on storage.objects need ownership of that table, which some projects
-- don't grant to the SQL editor role. Swallow that specific failure so it can
-- never roll back the tables above -- the notice below tells you to add the
-- three policies from the Storage → Policies UI instead.
do $$
begin
    drop policy if exists "media_public_read" on storage.objects;
    create policy "media_public_read" on storage.objects
        for select using (bucket_id = 'media');

    drop policy if exists "media_authenticated_insert" on storage.objects;
    create policy "media_authenticated_insert" on storage.objects
        for insert to authenticated with check (bucket_id = 'media');

    drop policy if exists "media_authenticated_delete" on storage.objects;
    create policy "media_authenticated_delete" on storage.objects
        for delete to authenticated using (bucket_id = 'media');
exception
    when insufficient_privilege then
        raise notice 'Could not create storage policies (%). Add them manually under Storage → Policies for the media bucket: public SELECT, authenticated INSERT, authenticated DELETE.', sqlerrm;
end;
$$;

-- Make the new tables visible to the REST API immediately.
notify pgrst, 'reload schema';
