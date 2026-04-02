# SetOS

Personal AI-powered calorie, macro, and workout tracker.

Log food via text, voice, or photos. Log workouts conversationally through Telegram. View daily and weekly summaries on a clean dashboard.

## Stack

- **Next.js 15** (App Router, TypeScript)
- **Tailwind CSS 4**
- **Supabase** (Auth, Postgres, Storage)
- **OpenAI** (food estimation, voice transcription, workout parsing fallback)
- **Telegram Bot** (conversational logging)
- **Cloudflare Workers** via OpenNext

## Setup

### 1. Prerequisites

- Node.js 20+
- npm
- Supabase project (free tier works)
- OpenAI API key
- Telegram bot (create via [@BotFather](https://t.me/BotFather))
- Cloudflare account (for deployment)

### 2. Install

```bash
npm install
```

### 3. Environment

```bash
cp .env.example .env
```

Fill in all values in `.env`.

### 4. Database

Run the SQL migration in your Supabase SQL editor:

```
db/migrations/001_initial_schema.sql
```

This creates all tables, indexes, RLS policies, and the auto-user-creation trigger.

### 5. Supabase Storage

Create a public bucket called `meal-images` in Supabase Storage for meal photo uploads.

### 6. Link Telegram Account

After signing up, add a Telegram alias to link your account:

1. Message your bot with `/start` to get your chat ID
2. Insert into `user_aliases` via Supabase dashboard:
   - `alias_type`: `telegram`
   - `alias_key`: your chat ID (from /start message)
   - `user_id`: your Supabase user ID

### 7. Set Telegram Webhook

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.com/api/telegram/webhook",
    "secret_token": "<YOUR_WEBHOOK_SECRET>"
  }'
```

## Development

```bash
npm run dev
```

Opens at http://localhost:3000.

For Telegram webhook testing locally, use a tunnel like `cloudflared tunnel` or `ngrok`.

## Deployment (Cloudflare Workers)

```bash
# Build and deploy
npm run deploy
```

Set secrets in the Cloudflare dashboard or via wrangler:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Also set the non-secret env vars (`NEXT_PUBLIC_*`, model names) in your `wrangler.jsonc` `vars` section or via the Cloudflare dashboard.

## Preview (local Cloudflare simulation)

```bash
npm run preview
```

## Architecture

```
app/          → Next.js pages and API routes
components/   → React UI components
lib/          → Supabase clients, OpenAI client, utilities
services/     → Business logic (food logging, workout parsing, daily totals)
bot/          → Telegram bot message handling and routing
prompts/      → OpenAI prompt templates
validators/   → Zod schemas for type safety
db/           → SQL migrations
```

## Key Flows

**Food logging:** Telegram message → bot routes to food handler → transcribes voice (if any) → downloads/uploads photo (if any) → OpenAI estimates macros → saves to `meal_logs` → recalculates `daily_nutrition_totals`

**Workout logging:** `/startworkout` → send sets as messages → deterministic parser tries first → LLM fallback if needed → saves exercises and sets → `/finishworkout`

**Dashboard:** Server components fetch today's totals, meals, workouts, and body weight from Supabase with RLS.

## Bot Commands

- `/start` — Setup instructions and chat ID
- `/help` — Usage guide
- `/today` — Today's nutrition and workout summary
- `/startworkout` — Begin a workout session
- `/finishworkout` — End current workout session
