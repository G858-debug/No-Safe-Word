# No Safe Word

South African erotic fiction platform.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** Supabase
- **AI Integration:** Civitai API
- **Hosting:** Railway

## Project Structure

```
no-safe-word/
├── app/
│   ├── api/
│   │   └── civitai/
│   │       └── route.ts        # Civitai API proxy endpoint
│   ├── globals.css              # Tailwind CSS directives
│   ├── layout.tsx               # Root layout
│   └── page.tsx                 # Home page
├── .env.example                 # Environment variable template
├── next.config.js               # Next.js configuration
├── package.json                 # Dependencies and scripts
├── postcss.config.js            # PostCSS config for Tailwind
├── tailwind.config.js           # Tailwind CSS configuration
└── tsconfig.json                # TypeScript configuration
```

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and add your API key:

   ```bash
   cp .env.example .env.local
   ```

3. Run the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## API Routes

### `GET /api/civitai`

Proxies requests to the Civitai API. Requires `CIVITAI_API_KEY` in environment variables.

**Query Parameters:**

| Parameter  | Default  | Description                          |
| ---------- | -------- | ------------------------------------ |
| `endpoint` | `models` | Civitai API endpoint to query        |
| `limit`    | `10`     | Number of results to return          |
| `query`    | -        | Search query string                  |

## Status

In development
