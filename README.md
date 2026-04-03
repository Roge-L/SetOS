# SetOS

Personal AI-powered calorie, macro, and workout tracker.

Log food via text, voice, or photos. Log workouts conversationally through Telegram. View daily and weekly summaries on a clean dashboard.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS 4 |
| Database & Auth | Supabase (Postgres, Auth, Storage) |
| Nutrition data | FatSecret API, Open Food Facts API |
| AI | OpenAI (function-calling agent, vision, transcription, web search) |
| Bot | Telegram Bot API (webhook + LLM agent router) |
| Hosting | Cloudflare Workers via OpenNext |
| Validation | Zod |

## Architecture

```
app/            → Next.js pages and API routes (App Router)
components/     → React UI components (client + server)
lib/            → Supabase clients, OpenAI client, shared utilities
services/       → Core business logic
  ├── openai/   → AI service layer (transcribe, estimate, parse)
  ├── fatsecret.ts        → FatSecret API client (restaurant + branded foods)
  ├── openfoodfacts.ts    → Open Food Facts client (packaged products)
  ├── food-logger.ts      → Food logging orchestrator (multi-source pipeline)
  ├── workout-parser.ts   → Deterministic workout parser
  ├── workout-logger.ts   → Workout session/set management
  └── daily-totals.ts     → Nutrition totals recalculation
bot/            → Telegram bot: LLM agent (agent.ts) + webhook handler
  ├── agent.ts  → Smart router: OpenAI function-calling agent with 8 tools
  └── handler.ts → Webhook entry point, photo/voice preprocessing
prompts/        → OpenAI prompt templates
validators/     → Zod schemas for runtime type safety
db/migrations/  → Postgres schema migrations (run in Supabase SQL editor)
```

### Food estimation pipeline

Text-based input (no photo) goes through a multi-source pipeline that short-circuits at the first hit:

| Step | Source | Best for | Cost |
|------|--------|----------|------|
| 1 | [FatSecret API](https://platform.fatsecret.com/api) | Restaurant meals, branded foods | Free (5,000/day) |
| 2 | [Open Food Facts API](https://wiki.openfoodfacts.org/API) | Packaged products (barcoded items) | Free (no key needed) |
| 3 | [OpenAI Responses API + web_search](https://platform.openai.com/docs/guides/tools-web-search) | Anything the databases miss | ~$0.025/search |
| 4 | [OpenAI Chat Completions](https://platform.openai.com/docs/guides/text-generation) | Last resort (training data only) | Standard token cost |

Photo-based input skips the pipeline entirely and goes straight to OpenAI vision.

Examples:

| Input | What happens |
|-------|-------------|
| `banana` | FatSecret match → done |
| `Nando's quarter chicken` | FatSecret restaurant match → done |
| `Quaker granola bar` | FatSecret or Open Food Facts match → done |
| `my mom's chicken stew` | Databases miss → OpenAI web search → done |
| Photo of nutrition label | Straight to OpenAI vision → done |
| Photo + caption | Straight to OpenAI vision with caption context → done |

### Smart agent (message routing)

Every text and voice message goes through an [OpenAI function-calling agent](https://platform.openai.com/docs/guides/function-calling) that decides what action(s) to take. Photos bypass the agent and go straight to OpenAI vision.

The agent uses a manual loop pattern ([ref](https://developers.openai.com/cookbook/examples/orchestrating_agents)) with:
- **`tool_choice: "auto"`** — model decides when to use tools vs reply conversationally
- **`parallel_tool_calls: false`** — avoids ordering bugs ([ref](https://developers.openai.com/cookbook/examples/o-series/o3o4-mini_prompting_guide))
- **`strict: true`** on all tools via [`zodFunction()`](https://github.com/openai/openai-node/blob/master/helpers.md) — guaranteed valid arguments ([ref](https://platform.openai.com/docs/guides/structured-outputs))
- **Max 5 iterations** — safety valve against infinite loops
- **gpt-4.1-mini** — fast, cheap (~$0.001/interaction), strong function calling

**Available tools:**

| Tool | Trigger |
|------|---------|
| `log_food` | User mentions eating/drinking something |
| `log_workout_sets` | User sends exercise data (auto-creates session if needed) |
| `start_workout` | User explicitly starts a workout |
| `finish_workout` | User says they're done working out |
| `move_meal` | "the eggs were actually yesterday" |
| `delete_meal` | "delete the string cheese" |
| `move_workout` | "the workout was last night" |
| `delete_workout` | "remove that workout" |

The agent can call **multiple tools in one turn** — e.g., "the workout was yesterday and the eggs were also yesterday" triggers two move operations.

### Key flows

**Text message:** Telegram → agent picks tool(s) → executes → responds with results

**Photo:** Telegram → download + upload to Supabase Storage → OpenAI vision estimates macros → save to `meal_logs`

**Voice:** Telegram → download → OpenAI transcription → transcribed text goes through agent

**Food estimation pipeline:** (see table above) FatSecret → Open Food Facts → OpenAI web search → OpenAI fallback

**Workout logging:** Agent calls `log_workout_sets` → deterministic parser tries first → LLM fallback if ambiguous → auto-creates session if needed → saves exercises and sets

**Dashboard:** Server components fetch today's totals, meals, workouts, and body weight from Supabase (RLS enforced per user).

---

## Initial Setup

### 1. Prerequisites

- Node.js 20+ and npm
- [Supabase](https://supabase.com) project
- [OpenAI](https://platform.openai.com) API key
- [FatSecret](https://platform.fatsecret.com) API credentials (free tier)
- [Telegram bot](https://t.me/BotFather) (create via @BotFather → `/newbot`)
- [Cloudflare](https://dash.cloudflare.com) account

### 2. Clone and install

```bash
git clone <repo-url> && cd SetOS
npm install
```

### 3. Environment variables

```bash
cp .env.example .env
```

Fill in every value. See `.env.example` for the full list.

| Variable | Where to get it |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` key |
| `OPENAI_API_KEY` | OpenAI → API Keys |
| `TELEGRAM_BOT_TOKEN` | @BotFather after `/newbot` |
| `TELEGRAM_WEBHOOK_SECRET` | Generate with `openssl rand -hex 32` |
| `FATSECRET_ID` | FatSecret → My Apps → your app → Client ID |
| `FATSECRET_SECRET` | FatSecret → My Apps → your app → Client Secret |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → Profile → API Tokens → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages → Account ID (right sidebar) |

### 4. Database

Open the **Supabase SQL Editor** and run the full contents of:

```
db/migrations/001_initial_schema.sql
```

This creates all tables, indexes, RLS policies, the auto-user-creation trigger, and the daily totals recalculation function.

### 5. Supabase Storage

In Supabase → Storage → New Bucket:

- **Name:** `meal-images`
- **Public:** Yes
- **File size limit:** 10 MB (recommended)
- **MIME types:** `image/jpeg, image/png, image/webp` (optional)

### 6. First deploy

```bash
npm run deploy
```

This runs `opennextjs-cloudflare build && opennextjs-cloudflare deploy`. Your app will be live at `https://setos.<your-subdomain>.workers.dev`.

### 7. Set Telegram webhook

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://setos.<your-subdomain>.workers.dev/api/telegram/webhook",
    "secret_token": "<WEBHOOK_SECRET>",
    "allowed_updates": ["message"],
    "drop_pending_updates": true
  }'
```

Verify:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

### 8. Link your Telegram account

1. Message your bot `/start` — it replies with your **chat ID**
2. Sign in to the web app to create your Supabase user
3. Insert a row into `user_aliases` (via Supabase Table Editor):
   - `user_id`: your Supabase auth user ID
   - `alias_type`: `telegram`
   - `alias_key`: your chat ID from step 1
   - `alias_value_json`: `{}`

---

## Development

### Local dev server

```bash
npm run dev
```

Runs Next.js at http://localhost:3000 with Turbopack (hot reload).

### Local Telegram testing

The Telegram webhook requires HTTPS. Use Cloudflare Tunnel to expose your local server:

```bash
# Terminal 1
npm run dev

# Terminal 2
cloudflared tunnel --url http://localhost:3000
```

Cloudflared prints a temporary URL like `https://random-words.trycloudflare.com`. Point the webhook to it:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<tunnel-subdomain>.trycloudflare.com/api/telegram/webhook",
    "secret_token": "<WEBHOOK_SECRET>",
    "allowed_updates": ["message"]
  }'
```

> **Important:** Switch the webhook back to your production URL when done.

### Preview (local Cloudflare simulation)

```bash
npm run preview
```

Builds with OpenNext and runs locally in a simulated Workers environment via Wrangler. Useful for testing Workers-specific behavior before deploying.

### Lint and type check

```bash
npm run lint
npm run build   # includes full TypeScript check
```

---

## Deployment

### Deploy to Cloudflare Workers

```bash
npm run deploy
```

This is the only deploy command you need. It runs `opennextjs-cloudflare build` (bundles Next.js for Workers) then `opennextjs-cloudflare deploy` (pushes to Cloudflare).

> **Do not** use `wrangler deploy` directly — it skips the OpenNext build step.

### Setting secrets

Secrets must be set via Wrangler CLI or the Cloudflare dashboard — they are not read from `.env` in production.

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put FATSECRET_ID
npx wrangler secret put FATSECRET_SECRET
```

Non-secret env vars (`NEXT_PUBLIC_*`, model names) go in `wrangler.jsonc` under `vars` or in the Cloudflare dashboard under Workers → Settings → Variables.

### Deploy checklist

1. `npm run build` passes locally (types + lint)
2. `npm run deploy`
3. Verify webhook: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` — no errors
4. Message `/start` to bot — should respond
5. Load dashboard in browser — should render

---

## Database Migrations

Migrations live in `db/migrations/` and are numbered sequentially (`001_`, `002_`, etc.).

**To apply a migration:** copy the SQL into the Supabase SQL Editor and run it.

There is no automated migration runner — this is intentional for a single-user personal tool. Keep migrations idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, etc.) so they are safe to re-run.

When adding new tables or columns:
1. Create `db/migrations/002_description.sql`
2. Use `IF NOT EXISTS` / `OR REPLACE` patterns
3. Include RLS policies for any new user-owned tables
4. Run in Supabase SQL Editor
5. Commit the migration file

---

## Available Scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Start local dev server (Turbopack) |
| `npm run build` | Production Next.js build + type check + lint |
| `npm run lint` | ESLint check |
| `npm run preview` | Build for Workers + local Wrangler preview |
| `npm run deploy` | Build for Workers + deploy to Cloudflare |
| `npm run cf-typegen` | Regenerate Cloudflare binding types (`cloudflare-env.d.ts`) |

---

## Bot Usage

The bot is conversational — just talk to it naturally. No commands required (though `/start` is needed for initial setup).

### Examples

**Food logging:**
- `2 eggs, toast with butter, protein shake`
- `poke bowl, ate most of the rice, all the salmon`
- `had a banana`
- Send a meal photo with caption: `chicken shawarma plate`
- Send a voice note describing what you ate

**Workout logging:**
- `bench 185x8`
- `incline db 60s 10 10 8`
- `lat pulldown 4x10 @ 140`
- `ran 25 min easy`

**Corrections (natural language):**
- `the eggs were actually yesterday`
- `move the workout to last night`
- `delete the string cheese`
- `the basketball workout and the ramen were both yesterday, fix them`

**Other:**
- `what did I eat today?` — agent responds conversationally
- `thanks` — agent replies without calling any tool
- `/start` — setup instructions + chat ID

---

## Environment Variables Reference

See `.env.example` for the complete list.

| Variable | Required | Client-exposed | Description |
|----------|----------|----------------|-------------|
| `NEXT_PUBLIC_APP_URL` | No | Yes | App base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | No | Supabase service role (server only) |
| `OPENAI_API_KEY` | Yes | No | OpenAI API key |
| `OPENAI_MODEL_TEXT` | No | No | Text model (default: `gpt-4.1-mini`) |
| `OPENAI_MODEL_VISION` | No | No | Vision model (default: `gpt-4.1-mini`) |
| `OPENAI_MODEL_TRANSCRIBE` | No | No | Transcription model (default: `gpt-4o-mini-transcribe`) |
| `TELEGRAM_BOT_TOKEN` | Yes | No | Telegram bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | No | Webhook verification secret |
| `FATSECRET_ID` | Yes | No | FatSecret client ID ([free tier](https://platform.fatsecret.com/api)) |
| `FATSECRET_SECRET` | Yes | No | FatSecret client secret |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | No | Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | Yes | No | Cloudflare API token (Workers edit permission) |
