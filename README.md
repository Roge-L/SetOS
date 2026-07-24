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

Full CRUD on every entity — meals, sessions, exercises, **individual sets**, weight.

| Group | Tools |
|---|---|
| Grounding | `setos_about` |
| Meals | `setos_log_meals` (batch), `setos_search_meals` (filters + pagination), `setos_update_meal` (any field, incl. moving days), `setos_delete_meals` |
| Food data | `setos_lookup_food` (FatSecret + Open Food Facts) |
| Workouts | `setos_log_workout` (whole session in one call), `setos_get_workouts`, `setos_update_workout`, `setos_update_exercise`, `setos_update_set`, `setos_delete_workout_items` (session\|exercise\|sets) |
| Analysis | `setos_exercise_history` (progression, volume, estimated 1RM, PRs) |
| Body | `setos_log_weight`, `setos_delete_weight` |
| Summaries | `setos_get_day`, `setos_get_summary` (any range ≤ 92 days) |

### Why 18 tools and not 40

Design follows published MCP guidance rather than mirroring the database:

- **Depth through parameters, not tool count.** One `setos_update_meal` patches any field — including the date, which is how a meal moves between days. That beats five micro-tools ([Anthropic: *Writing effective tools for agents*](https://www.anthropic.com/engineering/writing-tools-for-agents) — don't wrap endpoints 1:1).
- **Bundle what co-occurs.** A whole workout is one `setos_log_workout` call; a described plate of food is one `setos_log_meals` call ([AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/mcp-strategies/mcp-tool-strategy-scope.html) — bundle 3+ chained calls, keep ≤8 params).
- **Action-shaped reads.** `setos_get_day` and `setos_exercise_history` answer a question in one call instead of making the model aggregate several.
- **Stay under the selection cliff.** Tool-selection accuracy degrades past ~40–50 tools; 18 keeps headroom alongside your other MCP servers.

Reads carry `readOnlyHint`, deletes `destructiveHint`. Deletes require explicit ids (never a fuzzy name), so a single call can't remove the wrong record.

## Setup

### 1. Secrets

```bash
npx wrangler secret put SETOS_CONSENT_PASSPHRASE  # openssl rand -hex 24
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

The worker is a full **OAuth 2.1** authorization server (PKCE S256, Dynamic Client Registration, RFC 9728 metadata) — which is what claude.ai web / macOS / iOS connectors require. Since SetOS has one user, "consent" is a single passphrase instead of a login system.

**claude.ai web, macOS desktop, iPhone** — add it once and it appears on all three:

1. claude.ai → **Settings → Connectors → Add custom connector**
2. URL: `https://<worker>.workers.dev/mcp` (leave the OAuth fields blank)
3. Click **Connect** → the SetOS consent page opens → enter your `SETOS_CONSENT_PASSPHRASE` → **Approve**

**Claude Code** uses the same OAuth flow:

```bash
claude mcp add --transport http setos https://<worker>.workers.dev/mcp -s user
claude mcp login setos
```

**Security posture:** Dynamic Client Registration is open by spec, so registration *and* authorization both check a redirect-URI allowlist ([`src/oauth/redirects.ts`](src/oauth/redirects.ts)) limited to Anthropic's hosted callbacks plus RFC 8252 loopback — this closes the consent-phishing (confused deputy) hole. The consent request is HMAC-sealed between the form and the grant so it can't be tampered with. Tokens are hashed at rest by the provider; grant props are empty (Supabase credentials live in the worker's own env, never in a grant).

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
  index.ts        # OAuthProvider wiring: /mcp (token-gated) + DCR allowlist
  server.ts       # builds the McpServer + registers tools, with server instructions
  env.ts          # bindings/secrets contract
  oauth/
    handler.ts    # consent page: /authorize GET form + POST grant, landing, /health
    redirects.ts  # redirect-URI allowlist (threat model inside)
  db/             # supabase client + row types
  lib/            # dates (timezone/DST), format (rounding + untrusted wrapping), result helpers
  services/       # food, nutrition (FatSecret/OFF), workout, body, totals, summary
  tools/          # MCP tool definitions (zod I/O) grouped by domain
tests/            # vitest unit suites (dates/DST, macros, nutrition, redirect allowlist)
db/migrations/    # existing Postgres schema
```
