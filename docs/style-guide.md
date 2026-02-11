# Style Guide

## Code Style

- TypeScript for all new code
- Use ESLint and Prettier configurations
- Prefer functional components with hooks
- Use named exports for components

## File Organization

```
apps/
  dashboard/      # Story management dashboard
  web/            # Public website
packages/
  shared/         # Types, constants, utilities
  story-engine/   # Story import and database logic
  image-gen/      # Civitai API integration
```

## Naming Conventions

- **Components**: PascalCase (`StoryCard.tsx`)
- **Utilities**: camelCase (`formatDate.ts`)
- **Constants**: SCREAMING_SNAKE_CASE (`DEFAULT_SETTINGS`)
- **Types**: PascalCase (`CharacterData`)
- **Files**: kebab-case for directories, PascalCase for components

## TypeScript

- Always use explicit types for function parameters
- Use `interface` for object shapes
- Use `type` for unions and intersections
- Avoid `any`, use `unknown` when type is truly unknown

## React

- Use React Server Components by default (Next.js 14)
- Add `"use client"` only when needed
- Keep components small and focused
- Extract reusable logic into hooks

## API Routes

- Use Next.js App Router route handlers
- Return NextResponse for consistent error handling
- Validate input with Zod or similar
- Use service role key for server-side Supabase queries

## Database

- Use Supabase client from `@no-safe-word/story-engine`
- Always use parameterized queries
- Handle errors gracefully
- Use transactions for related operations

## Testing

- Write tests for business logic
- Use descriptive test names
- Test error cases
- Mock external APIs

## Git Workflow

- Branch naming: `feature/`, `fix/`, `docs/`
- Commit messages: Conventional Commits format
- PR titles: Brief description of change
- Keep PRs focused and small
