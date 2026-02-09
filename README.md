# Telegram Soundboard (Single Device)

This project provides a single-device WebSocket connection that can be controlled by a Telegram bot. The web client is intentionally minimal: it only connects and plays sound commands.

## Features
- One connected phone at a time.
- Telegram bot with upload + label workflow for MP3 sounds.
- Inline buttons for each stored sound.
- Disconnect button (only the bot can disconnect the device).
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
- Open `http://localhost:3000` on the phone and click **Connect device**.
- Chat with your bot. Upload an MP3 (audio or document). The bot asks for a label.
- Press sound buttons to play them on the connected device.
- Open `http://localhost:3000/admin` for status and event logs.

## Notes
- Set `WEBHOOK_URL` if you want to sync Telegram webhooks using the admin button.
- Sounds are stored in the `sounds/` directory and served from `/sounds/...`.
