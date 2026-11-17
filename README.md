# AxiomTAxis

One public Discord bot (yours) that anyone can invite. Runs 24/7 on Railway; the website (Netlify) shows the invite link.

- `bot-runner/` : the bot worker (Dockerfile). Deploy this on Railway.
- `website/` : static site with the **Add to Discord** invite button. Deploy on Netlify.
- `supabase/schema.sql` : OPTIONAL. Only needed if you want per-server settings to survive redeploys without a Railway volume.

## Features (per server)
- Simple: `/ping`, `/help`, custom commands (`/command add|remove|list`, run with `/c name`)
- Welcome: `/welcome set #channel [message]`, `/welcome off`
- AI chat: `/ai channel #channel` then the bot replies to every message in that channel, no mention needed. `/ai model provider model`, `/ai prompt`, `/ai off`, `/ai status`
- Music: `/play song name` (YouTube search, joins your VC, mini player with Pause/Resume, -10s, +10s, Stop), `/stop`

Setup commands need the *Manage Server* permission.

## Deploy

### Railway (bot worker)
New service from this repo, **Root Directory = `bot-runner`** (the Dockerfile is auto-detected). Variables:

| Name | Required | Value |
|---|---|---|
| `DISCORD_TOKEN` | yes | bot token |
| `DISCORD_CLIENT_ID` | yes | application (client) ID |
| `AXIOM_API_KEY` | for AI | your `ax_live_...` key |
| `AXIOM_API_URL` | no | defaults to the Axiom chat completions URL |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | no | store settings in Supabase |
| `YT_COOKIE` | no | only if YouTube blocks the server IP |
| `YT_API_KEY` | no | optional YouTube Data API v3 key for better `/play` search |

Without Supabase, settings are saved in `./data/settings.json`. To keep them across redeploys add a Railway Volume mounted at `/app/data`.

### Netlify (website)
Import the repo (settings come from `netlify.toml`). Variable: `DISCORD_CLIENT_ID`. Do NOT put the bot token in Netlify.

### Discord Developer Portal
Bot tab, enable **Server Members Intent** and **Message Content Intent**. Make the bot public (Installation / Bot tab: Public Bot on) so others can invite it. Bots in 100+ servers need Discord verification for these intents.
