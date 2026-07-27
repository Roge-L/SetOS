# SetOS

A personal calorie/macro + workout tracker you operate entirely by **talking to Claude**. SetOS is a single Cloudflare Worker that speaks the [Model Context Protocol](https://modelcontextprotocol.io) — you add it as a connector in Claude (Code, web, or mobile) and just say what you ate or lifted. Claude estimates the macros, expands your workout shorthand, and calls the tools to store and read it back.

There is **no frontend, no bot, and no server-side AI**. Claude is the intelligence; this worker is a clean, typed data layer over Supabase.

Originally single-user; it now supports a small invite-only group (family, a few friends), each with their own data and their own timezone.

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
- **Invite-only, multi-user.** Each person signs in with their own email and password; a row in `public.users` is the invitation. Every request is scoped to whoever's token it is, and Postgres RLS enforces the same boundary underneath.
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
npx wrangler secret put SETOS_STATE_SECRET        # openssl rand -hex 32
npx wrangler secret put SUPABASE_JWT_SECRET       # Settings → API → JWT keys
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put FATSECRET_ID              # optional (lookup_food)
npx wrangler secret put FATSECRET_SECRET          # optional (lookup_food)
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are non-secret `vars` in `wrangler.jsonc` (already filled in). The anon key grants nothing on its own — on the request path it is paired with a per-request user JWT that RLS evaluates.

### 2. Database

Run [`db/migrations/006_multi_user.sql`](db/migrations/006_multi_user.sql) in the Supabase SQL editor. It turns `public.users` into the invitation list, makes day boundaries per-user, and closes a `SECURITY DEFINER` hole that only mattered once there was more than one tenant.

It refuses to run if any existing user row has no email. Fix those first:

```sql
select id, email from public.users;
update public.users set email = 'you@example.com' where id = '<uuid>';
```

### 3. Supabase Auth settings

Dashboard → **Authentication → Providers → Email**: leave email/password enabled and **turn off "Allow new users to sign up"**. SetOS has no self-signup — you create accounts yourself, and a `public.users` row is the actual invitation.

### 4. Deploy

```bash
npm install
npm run deploy
```

Your MCP endpoint is `https://<worker>.<subdomain>.workers.dev/mcp` (or attach a custom domain in the Cloudflare dashboard).

## Connecting Claude

The worker is a full **OAuth 2.1** authorization server (PKCE S256, Dynamic Client Registration, RFC 9728 metadata) — which is what claude.ai web / macOS / iOS connectors require. Each person signs in with their own email and password.

**claude.ai web, macOS desktop, iPhone** — add it once and it appears on all three:

1. claude.ai → **Settings → Connectors → Add custom connector**
2. URL: `https://<worker>.workers.dev/mcp` (leave the OAuth fields blank)
3. Click **Connect** → the SetOS sign-in page opens → enter your email and password

**Claude Code** uses the same OAuth flow:

```bash
claude mcp add --transport http setos https://<worker>.workers.dev/mcp -s user
claude mcp login setos
```

## Inviting someone

Two steps, because two things must both be true — they need credentials, *and* they need an invitation.

1. **Create the account.** Supabase Dashboard → **Authentication → Users → Add user**, tick *Auto Confirm User*, and give them a password to change later. The `on_auth_user_created` trigger mirrors them into `public.users` automatically.
2. **Set their timezone**, which drives their day boundaries independently of everyone else's:

```sql
update public.users
set display_name = 'Brother', timezone = 'America/Los_Angeles'
where email = 'brother@example.com';
```

An account in `auth.users` without an active `public.users` row gets nothing — that second row is the invitation, so you can revoke access without deleting anyone's login.

```sql
-- Suspend (keeps their data, kills access on the next request)
update public.users set is_active = false where email = 'friend@example.com';

-- Revoke permanently — cascades to all of that person's meals, workouts, weights
delete from auth.users where email = 'friend@example.com';

-- Who has access, and when each last connected
select email, display_name, timezone, is_active from public.users order by created_at;
```

## Security posture

- **Tenant isolation, twice.** Every service query filters on `user_id`, and the request-path Supabase client authenticates as the caller (a short-lived HS256 JWT with `sub` = their id) so the RLS policies actually run. A future query that forgets its filter returns that user's own rows, not everyone's. The service-role key never reaches a tool handler — its only job is the invitation lookup right after a password checks out.
- **Identity, not a shared secret.** A passphrase can't say *which* holder is connecting and can't be revoked for one person. Each person now has their own credentials, and access is two independent checks: Supabase Auth must accept the password **and** an active `public.users` row must exist.
- **Passwords are not hashed in the Worker — on purpose.** A password hash must be deliberately slow (OWASP's PBKDF2-HMAC-SHA256 floor is 600k iterations, hundreds of ms of CPU) and Workers Free allows 10ms of CPU per request. Rolling our own would have meant either exceeding that limit or picking a weak iteration count. Supabase Auth verifies bcrypt server-side, which costs the worker a network hop and ~0ms of CPU, and brings rate limiting, strength rules, and reset emails along with it.
- **Consent phishing.** Dynamic Client Registration is open by spec, so registration *and* authorization both check a redirect-URI allowlist ([`src/oauth/redirects.ts`](src/oauth/redirects.ts)) limited to Anthropic's hosted callbacks plus RFC 8252 loopback.
- **The form round-trip.** The in-flight authorization request travels in an HMAC-signed, 10-minute blob, and its redirect URI is re-validated before the grant is issued, not just when the form was drawn. Failed sign-ins return one message for wrong-password, unknown-address, unconfirmed, and suspended alike, so the page can't be used to enumerate who has an account.
- **Revocation is immediate.** Timezone and `is_active` are re-read per request rather than baked into the grant, so suspending someone takes effect on their next call instead of at token expiry.
- **What's in a grant:** the user id and email, nothing else. Tokens are hashed at rest and props encrypted by the provider; Supabase credentials live in the worker's env and never enter a grant.

> You are the custodian of your friends' and family's health data. Deleting a `public.users` row cascades and is not recoverable without a backup.

## Local development

```bash
cp .dev.vars.example .dev.vars      # fill in secrets
npm run dev                          # wrangler dev
npm run inspector                    # @modelcontextprotocol/inspector → http://localhost:8787/mcp
```

## Quality gates

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest (incl. cross-tenant isolation + auth-flow suites)
npx wrangler deploy --dry-run
```

## Layout

```
src/
  index.ts        # OAuthProvider wiring: resolves the principal, gates /mcp, DCR allowlist
  server.ts       # builds the McpServer per request for one principal + registers tools
  env.ts          # bindings/secrets contract
  auth/
    password.ts   # email+password verification via Supabase Auth (no KDF in-worker)
    principal.ts  # invitation lookup (admin) + per-request profile load (RLS)
  oauth/
    handler.ts    # /authorize GET form + POST grant; landing, /health
    state.ts      # HMAC-signed blob carried between the form and its submission
    redirects.ts  # redirect-URI allowlist (threat model inside)
  db/             # per-user RLS client + admin client, row types
  lib/            # crypto (b64url/HMAC/JWT), dates (timezone/DST), format, result helpers
  services/       # food, nutrition (FatSecret/OFF), workout, body, totals, summary
  tools/          # MCP tool definitions (zod I/O) grouped by domain
tests/            # vitest: dates/DST, macros, nutrition, redirects, sealed state,
                  #   sign-in gating, cross-tenant isolation
db/migrations/    # Postgres schema; 006 is the multi-user migration
```
