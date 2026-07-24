# SetOS

A personal calorie/macro + workout tracker you operate entirely by **talking to Claude**. SetOS is a single Cloudflare Worker that speaks the [Model Context Protocol](https://modelcontextprotocol.io) — you add it as a connector in Claude (Code, web, or mobile) and just say what you ate or lifted. Claude estimates the macros, expands your workout shorthand, and calls the tools to store and read it back.

There is **no frontend, no bot, and no server-side AI**. Claude is the intelligence; this worker is a clean, typed data layer over Supabase.

> v2 rewrite. The old Next.js dashboard + Telegram bot + OpenAI estimation are gone — see git history if you need them.

---

## How it works

```
Claude (Code / web / mobile)
   │  Streamable HTTP + Authorization: Bearer <token>
   ▼
setos worker  ── /mcp ──▶  MCP tools ──▶ services ──▶ Supabase Postgres
   (Cloudflare)            (zod I/O)     (business     (meal_logs, workouts,
                                          logic)        daily totals, body weight)
```

- **Stateless.** Uses the Agents SDK `createMcpHandler` — no Durable Objects, runs on the Workers free tier.
- **One trusted user.** The worker holds the Supabase service-role key and scopes every query to `SETOS_USER_ID`.
- **Claude does the estimating.** `log_food` takes the macros Claude worked out; `lookup_food` fetches real numbers from FatSecret / Open Food Facts when you want ground truth.

## Tools

| Group | Tools |
|---|---|
| Grounding | `about` (what SetOS is, today's date, conventions) |
| Food | `log_food`, `lookup_food`, `list_meals`, `edit_meal`, `move_meal`, `delete_meal` |
| Workouts | `log_workout`, `list_workouts`, `move_workout`, `delete_workout` |
| Body | `log_weight` |
| Summaries | `get_day`, `get_week` |

Reads are marked `readOnlyHint`; deletes are marked `destructiveHint` and, when matched by a name/hint that's ambiguous, return the candidates instead of guessing.

## Setup

### 1. Secrets

```bash
npx wrangler secret put MCP_BEARER_TOKEN          # openssl rand -hex 32
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put FATSECRET_ID              # optional (lookup_food)
npx wrangler secret put FATSECRET_SECRET          # optional (lookup_food)
```

`SUPABASE_URL`, `SETOS_USER_ID`, and `SETOS_TIMEZONE` are non-secret `vars` in `wrangler.jsonc` (already filled in). `SETOS_TIMEZONE` (`America/New_York`) **must** match the timezone baked into the `recalculate_daily_totals()` SQL function, or day boundaries will disagree.

### 2. Database

The schema already exists (see [`db/migrations`](db/migrations)). No migration is required for v2 — it reuses the existing tables (`meal_logs`, `daily_nutrition_totals`, `workout_sessions`, `workout_exercises`, `workout_sets`, `body_metrics`). Find your `SETOS_USER_ID`:

```sql
select id, email from public.users;
```

### 3. Deploy

```bash
npm install
npm run deploy
```

Your MCP endpoint is `https://<worker>.<subdomain>.workers.dev/mcp` (or attach a custom domain in the Cloudflare dashboard).

## Connecting Claude

**Claude Code** (works today):

```bash
claude mcp add --transport http setos https://<worker>.workers.dev/mcp \
  --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
```

**claude.ai web / mobile** — add a custom connector with the `/mcp` URL. A static bearer token is entered under **Request headers** (`Authorization` = `Bearer <token>`). Note this **request-header auth is an Anthropic beta** (`static_headers`) that's rolled out gradually; if it isn't available on your account yet, the connector UI only offers OAuth. Auth is isolated in [`src/auth.ts`](src/auth.ts) so a minimal OAuth wrapper can drop in later without touching any tool or service.

## Local development

```bash
cp .dev.vars.example .dev.vars      # fill in secrets
npm run dev                          # wrangler dev
npm run inspector                    # @modelcontextprotocol/inspector → http://localhost:8787/mcp
```

## Quality gates

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest (dates/DST, macro rounding, nutrition parsing)
npx wrangler deploy --dry-run
```

## Layout

```
src/
  index.ts        # fetch handler: bearer gate → createMcpHandler
  auth.ts         # static bearer check (the only auth code; swap for OAuth here)
  server.ts       # builds the McpServer + registers tools, with server instructions
  env.ts          # bindings/secrets contract
  db/             # supabase client + row types
  lib/            # dates (timezone/DST), format (rounding + untrusted wrapping), result helpers
  services/       # food, nutrition (FatSecret/OFF), workout, body, totals, summary
  tools/          # MCP tool definitions (zod I/O) grouped by domain
tests/            # vitest unit suites
db/migrations/    # existing Postgres schema
```
