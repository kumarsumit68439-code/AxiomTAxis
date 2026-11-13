# AxiomTAxis

24/7 Discord bot hosting platform.

- `website/` : dashboard (Netlify). Login + create/manage bots (Supabase).
- `bot-runner/` : Node service (Railway). Reads bots from Supabase and keeps them online 24/7.
- `supabase/schema.sql` : database table + RLS policies.

Bot types: **simple** (slash commands only), **welcome**, **ai** (replies in a chat channel without mention, via Axiom API), **music** (YouTube search in VC, mini player with buttons).

## Setup

1. **Supabase**: create a project, run `supabase/schema.sql` in the SQL editor.
2. **Netlify**: import this repo. Build settings come from `netlify.toml`. Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
3. **Railway**: new service from this repo, Root Directory = `bot-runner` (Dockerfile is auto-detected). Env vars: see `bot-runner/.env.example`.
4. In the Discord Developer Portal enable the intents your bot type needs:
   - welcome: *Server Members Intent*
   - ai: *Message Content Intent*
   - simple / music: no privileged intent
5. Invite the bot with scopes `bot applications.commands` (music also needs Connect + Speak).

## Notes
- Discord bot tokens are stored in the `bots` table (protected by RLS per owner). Use the service role key ONLY in Railway, never in Netlify.
- Music uses `play-dl`. YouTube may block datacenter IPs; if so set `YT_COOKIE` in Railway.
