#!/usr/bin/env python3
"""
Fetch new Telegram chats that have messaged the bot and prompt
the user to add them to chat_ids.json.

Usage:
    python update_chats.py
"""

import json
import os
import urllib.request
from pathlib import Path


def _load_dotenv():
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).parent.parent / "data"))
CHATS_FILE = DATA_DIR / "chat_ids.json"
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")


def load_chats() -> list[dict]:
    if CHATS_FILE.exists():
        try:
            return json.loads(CHATS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            return []
    return []


def save_chats(chats: list[dict]):
    CHATS_FILE.write_text(json.dumps(chats, indent=2))


def get_updates() -> list[dict]:
    """Fetch recent messages to the bot via getUpdates."""
    if not TELEGRAM_BOT_TOKEN:
        print("TELEGRAM_BOT_TOKEN not set.")
        return []

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
    try:
        req = urllib.request.Request(url)
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        return data.get("result", [])
    except Exception as e:
        print(f"Failed to fetch updates: {e}")
        return []


def extract_chats(updates: list[dict]) -> dict[str, dict]:
    """Extract unique chats from updates. Returns {chat_id: {id, name, type}}."""
    chats = {}
    for update in updates:
        msg = update.get("message") or update.get("edited_message") or {}
        chat = msg.get("chat")
        if not chat:
            continue

        chat_id = str(chat["id"])
        if chat_id in chats:
            continue

        chat_type = chat.get("type", "private")
        if chat_type == "private":
            name = " ".join(
                filter(None, [chat.get("first_name"), chat.get("last_name")])
            ) or chat.get("username", "Unknown")
        else:
            name = chat.get("title", "Unknown group")

        chats[chat_id] = {"chat_id": chat_id, "name": name, "type": chat_type}

    return chats


def main():
    existing = load_chats()
    known_ids = {c["chat_id"] for c in existing}

    print("Fetching recent messages to the bot...")
    updates = get_updates()
    if not updates:
        print("No recent messages found.")
        return

    discovered = extract_chats(updates)
    new_chats = {cid: info for cid, info in discovered.items() if cid not in known_ids}

    if not new_chats:
        print(f"No new chats found. {len(known_ids)} chat(s) already registered.")
        return

    print(f"Found {len(new_chats)} new chat(s):\n")

    added = 0
    for chat_id, info in new_chats.items():
        label = f"{info['name']} ({info['type']}, id: {chat_id})"
        answer = input(f"  Add {label}? [y/N] ").strip().lower()
        if answer in ("y", "yes"):
            existing.append({
                "chat_id": chat_id,
                "name": info["name"],
                "alert_ids": None,  # null = receive all alerts
            })
            added += 1
            print(f"    Added.")
        else:
            print(f"    Skipped.")

    if added:
        save_chats(existing)
        print(f"\nSaved {added} new chat(s) to {CHATS_FILE.name}. "
              f"Total: {len(existing)} chat(s).")
    else:
        print("\nNo chats added.")


if __name__ == "__main__":
    main()
