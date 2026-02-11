-- Enable RLS on all tables
alter table if exists public.users enable row level security;
alter table if exists public.subscriptions enable row level security;
alter table if exists public.payments enable row level security;
alter table if exists public.content_types enable row level security;
alter table if exists public.characters enable row level security;
alter table if exists public.images enable row level security;
alter table if exists public.generation_jobs enable row level security;
alter table if exists public.story_series enable row level security;
alter table if exists public.story_posts enable row level security;
alter table if exists public.story_characters enable row level security;
alter table if exists public.story_image_prompts enable row level security;

-- Users: can only see/update their own profile
create policy "Users can view own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id);

-- Subscriptions: users see their own, admins see all
create policy "Users can view own subscriptions"
  on public.subscriptions for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.users
      where users.id = auth.uid()
      and users.role = 'admin'
    )
  );

-- Payments: users see their own, admins see all
create policy "Users can view own payments"
  on public.payments for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.users
      where users.id = auth.uid()
      and users.role = 'admin'
    )
  );

-- Content types: all authenticated users can read, only admins can modify
create policy "Authenticated users can view content types"
  on public.content_types for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage content types"
  on public.content_types for all
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid()
      and users.role = 'admin'
    )
  );

-- Characters: authenticated users can CRUD
create policy "Authenticated users can manage characters"
  on public.characters for all
  using (auth.role() = 'authenticated');

-- Images: authenticated users can CRUD
create policy "Authenticated users can manage images"
  on public.images for all
  using (auth.role() = 'authenticated');

-- Generation jobs: authenticated users can CRUD
create policy "Authenticated users can manage generation jobs"
  on public.generation_jobs for all
  using (auth.role() = 'authenticated');

-- Story series: authenticated users can CRUD, public can read published
create policy "Authenticated users can manage story series"
  on public.story_series for all
  using (auth.role() = 'authenticated');

create policy "Public can view published story series"
  on public.story_series for select
  using (status = 'published');

-- Story posts: authenticated users can CRUD, public can read published
create policy "Authenticated users can manage story posts"
  on public.story_posts for all
  using (auth.role() = 'authenticated');

create policy "Public can view published story posts"
  on public.story_posts for select
  using (
    exists (
      select 1 from public.story_series
      where story_series.id = story_posts.series_id
      and story_series.status = 'published'
    )
  );

-- Story characters: authenticated users can CRUD
create policy "Authenticated users can manage story characters"
  on public.story_characters for all
  using (auth.role() = 'authenticated');

-- Story image prompts: authenticated users can CRUD
create policy "Authenticated users can manage story image prompts"
  on public.story_image_prompts for all
  using (auth.role() = 'authenticated');
