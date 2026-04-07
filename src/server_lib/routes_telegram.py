"""Route handlers for /api/telegram/* and /api/chats endpoints."""

import json
import os
import urllib.request
import urllib.parse

from .config import DATA_DIR
from .data_store import load_chats, save_chats

from . import config as cfg


def handle_telegram_status(handler):
    chats = load_chats()
    handler._json_response(200, {
        "configured": bool(cfg.TELEGRAM_BOT_TOKEN and (cfg.TELEGRAM_CHAT_ID or chats)),
        "has_bot_token": bool(cfg.TELEGRAM_BOT_TOKEN),
        "has_chat_id": bool(cfg.TELEGRAM_CHAT_ID or chats),
    })


def handle_chats_get(handler):
    handler._json_response(200, load_chats())


def handle_telegram_setup(handler, body):
    bot_token = body.get("bot_token", "").strip()
    chat_id = body.get("chat_id", "").strip()
    chat_name = body.get("chat_name", "").strip() or "Owner"

    if not bot_token:
        handler._json_response(400, {"error": "Bot token is required"})
        return

    # Validate bot token
    try:
        url = f"https://api.telegram.org/bot{bot_token}/getMe"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            me = json.loads(resp.read().decode())
        if not me.get("ok"):
            handler._json_response(400, {"error": "Invalid bot token"})
            return
        bot_name = me.get("result", {}).get("username", "unknown")
    except Exception as e:
        print(f"[telegram] getMe failed: {type(e).__name__}: {e}", flush=True)
        handler._json_response(400, {"error": f"Could not validate bot token: {e}"})
        return

    # Test message if chat_id provided
    if chat_id:
        try:
            msg_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            msg_data = urllib.parse.urlencode({
                "chat_id": chat_id,
                "text": "✅ Property Listings bot connected successfully!",
            }).encode()
            req = urllib.request.Request(msg_url, data=msg_data)
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode())
            if not result.get("ok"):
                handler._json_response(400, {"error": "Could not send message to that chat ID. Make sure you've messaged the bot first."})
                return
        except Exception as e:
            print(f"[telegram] sendMessage failed: {type(e).__name__}: {e}", flush=True)
            handler._json_response(400, {"error": f"Could not reach chat: {e}"})
            return

    # Save credentials
    cfg.TELEGRAM_BOT_TOKEN = bot_token
    cfg.TELEGRAM_CHAT_ID = chat_id
    os.environ["TELEGRAM_BOT_TOKEN"] = bot_token
    os.environ["TELEGRAM_CHAT_ID"] = chat_id

    tg_env = DATA_DIR / ".env.telegram"
    tg_env.write_text(f"TELEGRAM_BOT_TOKEN={bot_token}\nTELEGRAM_CHAT_ID={chat_id}\n")

    if chat_id:
        chats = load_chats()
        if not any(c["chat_id"] == chat_id for c in chats):
            chats.append({"chat_id": chat_id, "name": chat_name, "alert_ids": None})
            save_chats(chats)

    # Update .env.cron
    cron_env = DATA_DIR / ".env.cron"
    if cron_env.exists():
        lines = cron_env.read_text().splitlines()
        new_lines = [l for l in lines if not l.startswith("TELEGRAM_BOT_TOKEN=") and not l.startswith("TELEGRAM_CHAT_ID=")]
        new_lines.append(f"TELEGRAM_BOT_TOKEN={bot_token}")
        new_lines.append(f"TELEGRAM_CHAT_ID={chat_id}")
        cron_env.write_text("\n".join(new_lines) + "\n")

    handler._json_response(200, {"ok": True, "bot_name": bot_name})


def handle_discover_chats(handler):
    if not cfg.TELEGRAM_BOT_TOKEN:
        handler._json_response(400, {"error": "Bot token not configured yet"})
        return
    try:
        url = f"https://api.telegram.org/bot{cfg.TELEGRAM_BOT_TOKEN}/getUpdates"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        if not data.get("ok"):
            handler._json_response(500, {"error": "Failed to fetch updates from Telegram"})
            return
        seen = {}
        for update in data.get("result", []):
            msg = update.get("message", {})
            chat = msg.get("chat", {})
            cid = str(chat.get("id", ""))
            if not cid:
                continue
            name = chat.get("first_name", "") or chat.get("title", "") or cid
            seen[cid] = {"chat_id": cid, "name": name, "type": chat.get("type", "")}
        existing = {c["chat_id"] for c in load_chats()}
        discovered = [c for c in seen.values() if c["chat_id"] not in existing]
        handler._json_response(200, {"chats": discovered})
    except Exception as e:
        handler._json_response(500, {"error": f"Failed to discover chats: {e}"})


def handle_add_chat(handler, body):
    chat_id = str(body.get("chat_id", "")).strip()
    chat_name = body.get("name", "").strip() or chat_id
    if not chat_id:
        handler._json_response(400, {"error": "chat_id is required"})
        return
    chats = load_chats()
    if any(c["chat_id"] == chat_id for c in chats):
        handler._json_response(409, {"error": "Chat already exists"})
        return
    chats.append({"chat_id": chat_id, "name": chat_name, "alert_ids": None})
    save_chats(chats)
    handler._json_response(201, {"ok": True})
