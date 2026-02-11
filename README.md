# No Safe Word - Monorepo

A monorepo for managing story creation, character generation, image generation, and multi-platform publishing (Facebook + website) for South Africa's premier erotic fiction platform.

## Structure

```
no-safe-word/
├── apps/
│   ├── dashboard/    # Story management dashboard (Next.js 14)
│   └── web/          # Public website (Next.js 14) - Coming Soon
├── packages/
│   ├── shared/       # Shared types, constants, utilities
│   ├── story-engine/ # Story import and database logic
│   └── image-gen/    # Civitai API integration
├── scripts/          # Automation scripts
├── content/          # Story content, images, prompts
│   ├── stories/      # Exported story markdown files
│   ├── images/       # Generated images from Civitai
│   └── prompts/      # Reusable image generation prompts
├── docs/             # Documentation
│   ├── writing-guide.md
│   └── style-guide.md
└── supabase/
    ├── schema.sql    # Database schema
    └── migrations/   # Database migrations
```

## Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn
- Supabase account
- Civitai API key
- (Optional) Railway account for deployment
- (Optional) Facebook Page for publishing

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Edit .env.local with your keys
```

### Environment Variables

```bash
# Civitai API
CIVITAI_API_KEY=your_civitai_api_key

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Facebook (optional)
FACEBOOK_PAGE_ID=your_facebook_page_id
FACEBOOK_PAGE_TOKEN=your_facebook_page_access_token

# Webhook (optional)
WEBHOOK_SECRET=your_webhook_secret
```

### Database Setup

1. Create a Supabase project
2. Run the migrations:

```sql
-- In Supabase SQL Editor
-- Run supabase/schema.sql first
-- Then run supabase/migrations/002_add_user_tables.sql
-- Then run supabase/migrations/003_enable_rls.sql (if you want RLS enabled)
```

### Development

```bash
# Start dashboard in development mode
npm run dev

# Start web app (on port 3001)
npm run dev --workspace=@no-safe-word/web

# Build all packages
npm run build

# Lint all packages
npm run lint
```

## Packages

### @no-safe-word/shared

Shared types, constants, and utilities used across all apps and packages.

**Exports:**
- Types: `CharacterData`, `SceneData`, `GenerationSettings`, `StoryImportPayload`
- Constants: `DEFAULT_SETTINGS`, `ASPECT_RATIOS`, `MODEL_PRESETS`
- Utilities: `cn()`, `slugify()`

### @no-safe-word/story-engine

Story import logic, database operations, and Supabase client.

**Key Functions:**
- `importStory()` - Import story from JSON payload
- `supabase` - Supabase client with service role key
- `createBrowserClient()` - Client-side Supabase client

### @no-safe-word/image-gen

Civitai API integration for character and scene image generation.

**Key Functions:**
- `submitGeneration()` - Submit text-to-image job
- `getJobStatus()` - Poll job results
- `buildPrompt()` - Build positive prompt from character + scene
- `buildNegativePrompt()` - Build negative prompt

### @no-safe-word/dashboard

Next.js app for managing stories, characters, images, and publishing.

**Features:**
- Story import via JSON
- Character portrait generation and approval
- Story scene image generation
- Facebook publishing integration
- Multi-tab dashboard interface

### @no-safe-word/web

Public-facing website for readers (coming soon).

## Workflow

1. **Create Story** - Write story content in JSON format
2. **Import** - Import story via `/dashboard/stories/import`
3. **Generate Characters** - Generate and approve character portraits
4. **Generate Images** - Generate story scene images (SFW + NSFW)
5. **Review** - Preview Facebook post and website formats
6. **Publish** - Publish to Facebook and website

## Deployment

### Railway

The dashboard is configured for deployment to Railway.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Deploy
railway up
```

Environment variables must be set in Railway dashboard.

### Docker

```bash
# Build Docker image
docker build -t no-safe-word-dashboard -f apps/dashboard/Dockerfile .

# Run container
docker run -p 3000:3000 --env-file .env.local no-safe-word-dashboard
```

## Documentation

- [Writing Guide](./docs/writing-guide.md) - Story structure and best practices
- [Style Guide](./docs/style-guide.md) - Code conventions and standards

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI + Shadcn/ui
- **Database**: Supabase (PostgreSQL)
- **Image Generation**: Civitai API
- **Publishing**: Facebook Graph API
- **Build Tool**: Turbo
- **Deployment**: Railway

## License

Private - All Rights Reserved

---

Built with ❤️ for South African erotic fiction readers.
