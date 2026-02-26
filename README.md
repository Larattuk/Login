# Telegram Soundboard (Multi Device)

This project provides a multi-device WebSocket connection controlled by a Telegram bot. You can connect multiple phones and choose one target device (or all devices) from Telegram.

## Features
- Multiple connected phones at the same time.
- `/device` command to view connected devices and select active target.
- Automatic device naming (detected from browser/device).
- `/add` command enables one protected upload flow (prevents accidental sound adds).
- `/del name_song` deletes saved sounds.
- Inline buttons for each stored MP3 sound.
- Background-friendly playback improvements (wake lock + media session hints in browser).
- `/admin` console for webhook status, forcing sync, and live Telegram update logs.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file:

```bash
cp .env.example .env
```

3. Start the server:

```bash
npm start
```

## Usage
- Open `http://localhost:3000` on each phone and tap the full-screen **Connect** button (name is detected automatically).
- In Telegram:
  - `/device` — list devices and choose active one (or all).
  - `/add` — enable upload mode, then send one `.mp3` file.
  - `/del name_song` — remove a saved sound.
- Press sound buttons to play on selected device(s).
- Open `http://localhost:3000/admin` for status and event logs.

## Notes
- Set `WEBHOOK_URL` if you want to sync Telegram webhooks using the admin button.
- Sounds are stored in `sounds/` and served from `/sounds/...`.
