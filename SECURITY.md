# Security

## Reporting a vulnerability

Please open a private security advisory on GitHub or email the maintainer
directly rather than filing a public issue.

## Threat model

This project is a **single-user, self-hosted** scraper + viewer. It is
designed to run on a trusted network (your laptop, a private VPS, your home
LAN). It is **not** hardened for exposure on the public internet.

## What is sensitive on disk

When you configure Telegram notifications through the setup UI, the bot
token and chat IDs are written to the data volume:

| File                          | Contents                                |
|-------------------------------|-----------------------------------------|
| `data/.env.telegram`          | `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (plaintext) |
| `data/chat_ids.json`          | Subscribed chat IDs                     |
| `data/alerts.json`            | Alert criteria (may include pin coords) |

Treat the data volume the same way you would treat an `~/.ssh` directory:

- Never commit it (the seed files `*.seed.json` are the only checked-in versions).
- Never include it in a `docker save` image you share.
- Back it up to encrypted storage only.
- If the volume is ever exposed, **rotate the Telegram bot token immediately**
  via [@BotFather](https://t.me/BotFather) → `/revoke` then `/token`.

## Network surface

The HTTP server (`server.py`) listens on `0.0.0.0:8080` by default with **no
authentication and no CORS restriction**. This is intentional for the local /
LAN use case but means:

- Do not expose port 8080 directly to the internet.
- If you want remote access, put it behind a reverse proxy (Caddy / Traefik /
  nginx) with HTTP basic auth or your SSO of choice.
- The `/api/telegram/*` endpoints can read and overwrite the bot token —
  anyone who can reach port 8080 can reconfigure your bot.

## Dependencies

Runtime dependencies are pinned in `requirements.txt` and `ui/package-lock.json`.
Dev/test dependencies live in `requirements-dev.txt`.
