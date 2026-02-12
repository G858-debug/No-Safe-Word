-- NSW Users table (separate from fitness app users)
create table if not exists public.nsw_users (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nsw_users is 'No Safe Word user profiles';

-- NSW Subscriptions table
create table if not exists public.nsw_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.nsw_users(id) on delete cascade,
  plan text not null check (plan in ('free', 'basic', 'premium', 'enterprise')),
  status text not null check (status in ('active', 'cancelled', 'expired', 'trial')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.nsw_subscriptions is 'No Safe Word subscription plans';
create index if not exists idx_nsw_subscriptions_user_id on public.nsw_subscriptions(user_id);
create index if not exists idx_nsw_subscriptions_status on public.nsw_subscriptions(status);

-- NSW Payments table
create table if not exists public.nsw_payments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.nsw_users(id) on delete cascade,
  subscription_id uuid references public.nsw_subscriptions(id) on delete set null,
  amount numeric not null,
  currency text not null default 'ZAR',
  status text not null check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  payment_provider text check (payment_provider in ('paystack', 'yoco', 'stripe')),
  provider_payment_id text unique,
  created_at timestamptz not null default now()
);

comment on table public.nsw_payments is 'No Safe Word payment transaction history';
create index if not exists idx_nsw_payments_user_id on public.nsw_payments(user_id);
create index if not exists idx_nsw_payments_status on public.nsw_payments(status);

-- Content types table
create table if not exists public.content_types (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  description text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.content_types is 'Configurable content type definitions';
comment on column public.content_types.settings is 'JSON: validation rules, required fields, publishing options';

-- Add updated_at triggers
create trigger nsw_users_updated_at
  before update on public.nsw_users
  for each row
  execute function update_updated_at();

create trigger nsw_subscriptions_updated_at
  before update on public.nsw_subscriptions
  for each row
  execute function update_updated_at();

create trigger content_types_updated_at
  before update on public.content_types
  for each row
  execute function update_updated_at();

-- Ensure story tables exist (they might already be in the database)
create table if not exists public.story_series (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  slug text not null unique,
  description text,
  total_parts integer not null,
  hashtag text,
  status text not null default 'draft' check (status in ('draft', 'characters_pending', 'images_pending', 'review', 'scheduled', 'published', 'archived')),
  marketing jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.story_posts (
  id uuid primary key default uuid_generate_v4(),
  series_id uuid not null references public.story_series(id) on delete cascade,
  part_number integer not null,
  title text not null,
  facebook_content text not null,
  facebook_teaser text,
  facebook_comment text,
  website_content text not null,
  hashtags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'images_pending', 'images_approved', 'ready', 'scheduled', 'published')),
  facebook_post_id text,
  published_at timestamptz,
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(series_id, part_number)
);

create table if not exists public.story_characters (
  id uuid primary key default uuid_generate_v4(),
  series_id uuid not null references public.story_series(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  role text not null,
  prose_description text,
  approved boolean not null default false,
  approved_image_id uuid references public.images(id) on delete set null,
  approved_seed integer,
  unique(series_id, character_id)
);

create table if not exists public.story_image_prompts (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references public.story_posts(id) on delete cascade,
  image_type text not null check (image_type in ('facebook_sfw', 'website_nsfw_paired', 'website_only')),
  pairs_with uuid references public.story_image_prompts(id) on delete set null,
  position integer not null,
  position_after_word integer,
  character_name text,
  character_id uuid references public.characters(id) on delete set null,
  prompt text not null,
  image_id uuid references public.images(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'generating', 'generated', 'approved', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for story tables
create index if not exists idx_story_posts_series_id on public.story_posts(series_id);
create index if not exists idx_story_characters_series_id on public.story_characters(series_id);
create index if not exists idx_story_image_prompts_post_id on public.story_image_prompts(post_id);

-- Triggers for story tables
create trigger story_series_updated_at
  before update on public.story_series
  for each row
  execute function update_updated_at();

create trigger story_posts_updated_at
  before update on public.story_posts
  for each row
  execute function update_updated_at();

create trigger story_image_prompts_updated_at
  before update on public.story_image_prompts
  for each row
  execute function update_updated_at();
