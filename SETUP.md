# Setup Guide

## Database Migrations

### Step 1: Run Migration 002 (User Tables)

Copy and paste into Supabase SQL Editor:

```sql
-- Users table (extends Supabase auth.users)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is 'User profiles extending Supabase auth';

-- Subscriptions table
create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan text not null check (plan in ('free', 'basic', 'premium', 'enterprise')),
  status text not null check (status in ('active', 'cancelled', 'expired', 'trial')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is 'User subscription plans';
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);

-- Payments table
create table if not exists public.payments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount numeric not null,
  currency text not null default 'ZAR',
  status text not null check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  payment_provider text check (payment_provider in ('paystack', 'yoco', 'stripe')),
  provider_payment_id text unique,
  created_at timestamptz not null default now()
);

comment on table public.payments is 'Payment transaction history';
create index if not exists idx_payments_user_id on public.payments(user_id);
create index if not exists idx_payments_status on public.payments(status);

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

-- Add updated_at triggers
create trigger users_updated_at
  before update on public.users
  for each row
  execute function update_updated_at();

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row
  execute function update_updated_at();

create trigger content_types_updated_at
  before update on public.content_types
  for each row
  execute function update_updated_at();
```

### Step 2: Run Migration 003 (RLS - Optional)

Only run this when you're ready to enable authentication. You'll need to add `SUPABASE_SERVICE_ROLE_KEY` to your `.env.local` first.

See: `supabase/migrations/003_enable_rls.sql`

## Install Dependencies for New Features

```bash
cd apps/dashboard

# Install rich text editor and AI features
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder @anthropic-ai/sdk
```

## Environment Variables

Add to your `.env.local`:

```bash
# For AI-assisted editing (optional)
ANTHROPIC_API_KEY=your_anthropic_api_key

# For RLS (when you enable it)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## New Features Available

### 1. Rich Text Editor

Use the `RichTextEditor` component in any form:

```tsx
import { RichTextEditor } from '@/components/RichTextEditor';

<RichTextEditor
  content={content}
  onChange={setContent}
  placeholder="Write something..."
/>
```

### 2. Story Creation Form

Navigate to: `/dashboard/stories/create`

Or add a link in your stories list page:

```tsx
<Button asChild>
  <Link href="/dashboard/stories/create">
    Create New Story
  </Link>
</Button>
```

### 3. Side-by-Side Preview

Use the `PreviewPanel` component:

```tsx
import { PreviewPanel } from '@/components/PreviewPanel';

<PreviewPanel
  facebookContent={facebookContent}
  websiteContent={websiteContent}
  images={images}
  hashtags={['#NoSafeWord', '#EroticFiction']}
/>
```

### 4. AI-Assisted Editing

Call the API endpoint:

```tsx
const response = await fetch('/api/ai/suggest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    content: yourContent,
    type: 'facebook', // or 'website' or 'continuation'
  }),
});

const { suggestion } = await response.json();
```

### 5. Example Story Edit Page

See the full integration example at:
`apps/dashboard/app/dashboard/stories/[seriesId]/edit/[postId]/page.tsx`

## Testing the New Features

1. **Test story creation**:
   ```bash
   npm run dev
   # Navigate to http://localhost:3000/dashboard/stories/create
   ```

2. **Test rich text editor**: Open any story edit page

3. **Test AI suggestions**: You'll need an Anthropic API key

4. **Test preview**: Edit a story post and switch to the Preview tab

## Next Steps

1. Run the database migrations
2. Install the npm packages
3. Add environment variables
4. Test the new features
5. Customize the components to match your design preferences

## Troubleshooting

**npm install fails**: Try clearing npm cache:
```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

**Tiptap not working**: Make sure you're using it in a client component (`"use client"`)

**AI suggestions fail**: Check that `ANTHROPIC_API_KEY` is set correctly

**Database errors**: Ensure migrations ran successfully in Supabase SQL Editor
