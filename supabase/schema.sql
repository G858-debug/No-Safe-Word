-- No Safe Word - Database Schema
-- Run this in the Supabase SQL Editor to set up the database

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Characters table
create table characters (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table characters is 'Character profiles for image generation';
comment on column characters.description is 'JSON: gender, ethnicity, bodyType, hairColor, hairStyle, eyeColor, skinTone, distinguishingFeatures, clothing, pose, expression, age';

-- Images table
create table images (
  id uuid primary key default uuid_generate_v4(),
  character_id uuid references characters(id) on delete set null,
  sfw_url text,
  nsfw_url text,
  prompt text not null,
  negative_prompt text not null default '',
  settings jsonb not null default '{}',
  mode text not null default 'sfw' check (mode in ('sfw', 'nsfw')),
  created_at timestamptz not null default now()
);

comment on table images is 'Generated images linked to characters';
comment on column images.settings is 'JSON: modelUrn, width, height, steps, cfgScale, scheduler, seed, clipSkip, batchSize';

create index idx_images_character_id on images(character_id);
create index idx_images_created_at on images(created_at desc);

-- Generation jobs table
create table generation_jobs (
  id uuid primary key default uuid_generate_v4(),
  job_id text not null unique,
  image_id uuid references images(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  cost numeric,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table generation_jobs is 'Tracks Civitai generation job lifecycle';

create index idx_generation_jobs_job_id on generation_jobs(job_id);
create index idx_generation_jobs_status on generation_jobs(status);
create index idx_generation_jobs_image_id on generation_jobs(image_id);

-- Auto-update updated_at on characters
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger characters_updated_at
  before update on characters
  for each row
  execute function update_updated_at();

-- Row Level Security (enable when auth is added)
-- alter table characters enable row level security;
-- alter table images enable row level security;
-- alter table generation_jobs enable row level security;
