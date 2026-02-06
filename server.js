const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  "8378410005:AAFX_C5igOXn5YFJQiL7U0HFKjO0DK_JaDE";
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID || "944944398";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

const soundsDir = path.join(__dirname, "sounds");
if (!fs.existsSync(soundsDir)) {
  fs.mkdirSync(soundsDir, { recursive: true });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/sounds", express.static(soundsDir));

let connectedSocket = null;
let connectedAt = null;
const pendingLabels = new Map();
const updateLog = [];
const MAX_UPDATES = 100;

const logUpdate = (type, payload) => {
  updateLog.unshift({
    time: new Date().toISOString(),
    type,
    payload,
  });
  if (updateLog.length > MAX_UPDATES) {
    updateLog.pop();
  }
};

const safeFilename = (label) => {
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned || `sound-${Date.now()}`;
};

const listSoundButtons = () => {
  const files = fs.readdirSync(soundsDir).filter((file) => file.endsWith(".mp3"));
  if (!files.length) {
    return null;
  }
  return {
    inline_keyboard: files.map((file) => [
      {
        text: path.basename(file, ".mp3"),
        callback_data: `play:${file}`,
      },
    ]),
  };
};

const sendOwnerMessage = async (text, options = {}) => {
  try {
    await bot.sendMessage(OWNER_CHAT_ID, text, options);
  } catch (error) {
    console.error("Failed to send owner message:", error.message);
  }
};

const notifyDeviceConnected = async () => {
  const keyboard = {
    inline_keyboard: [
      [{ text: "Disconnect device", callback_data: "disconnect" }],
    ],
  };
  await sendOwnerMessage(
    "A device connected via WebSocket.",
    { reply_markup: keyboard }
  );
};

const disconnectDevice = () => {
  if (connectedSocket) {
    connectedSocket.close(1000, "Disconnected by owner");
    connectedSocket = null;
    connectedAt = null;
    return true;
  }
  return false;
};

wss.on("connection", (socket) => {
  if (connectedSocket) {
    socket.close(1008, "Another device is already connected");
    return;
  }
  connectedSocket = socket;
  connectedAt = new Date();
  notifyDeviceConnected();

  socket.on("close", () => {
    connectedSocket = null;
    connectedAt = null;
  });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin/status", (req, res) => {
  res.json({
    connected: Boolean(connectedSocket),
    connectedAt,
  });
});

app.get("/admin/webhook-status", async (req, res) => {
  try {
    const info = await bot.getWebhookInfo();
    res.json({ ok: true, info });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/admin/force-webhook-sync", async (req, res) => {
  try {
    if (!WEBHOOK_URL) {
      return res.json({
        ok: false,
        message: "WEBHOOK_URL not set. Provide a public URL to sync webhooks.",
      });
    }
    await bot.setWebHook(WEBHOOK_URL);
    const info = await bot.getWebhookInfo();
    res.json({ ok: true, info });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/admin/events", (req, res) => {
  res.json({
    updates: updateLog,
  });
});

const downloadFile = async (fileId, destinationPath) => {
  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error("Failed to download file from Telegram");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(destinationPath, buffer);
};

const askForLabel = async (chatId) => {
  await bot.sendMessage(
    chatId,
    "Send a label for this sound (this becomes the button name)."
  );
};

const handleSoundUpload = async (msg, fileId, fileName) => {
  if (String(msg.chat.id) !== String(OWNER_CHAT_ID)) {
    await bot.sendMessage(msg.chat.id, "Only the owner can upload sounds.");
    return;
  }
  if (!fileName.toLowerCase().endsWith(".mp3")) {
    await bot.sendMessage(msg.chat.id, "Only MP3 files are supported.");
    return;
  }
  const tempPath = path.join(soundsDir, `upload-${Date.now()}.mp3`);
  try {
    await downloadFile(fileId, tempPath);
    pendingLabels.set(msg.chat.id, { tempPath });
    await askForLabel(msg.chat.id);
  } catch (error) {
    await bot.sendMessage(msg.chat.id, `Upload failed: ${error.message}`);
  }
};

const sendSoundKeyboard = async (chatId) => {
  const keyboard = listSoundButtons();
  if (!keyboard) {
    await bot.sendMessage(chatId, "No sounds available yet. Upload an MP3.");
    return;
  }
  await bot.sendMessage(chatId, "Available sounds:", {
    reply_markup: keyboard,
  });
};

bot.onText(/\/start/, async (msg) => {
  logUpdate("command", msg);
  await bot.sendMessage(
    msg.chat.id,
    "Soundboard bot ready. Upload an MP3 or press a sound button to play it."
  );
  await sendSoundKeyboard(msg.chat.id);
});

bot.on("callback_query", async (query) => {
  logUpdate("callback_query", query);
  const data = query.data || "";
  if (data === "disconnect") {
    const disconnected = disconnectDevice();
    await bot.answerCallbackQuery(query.id, {
      text: disconnected ? "Device disconnected." : "No device connected.",
    });
    if (disconnected) {
      await sendOwnerMessage("Device disconnected.");
    }
    return;
  }
  if (data.startsWith("play:")) {
    if (!connectedSocket) {
      await bot.answerCallbackQuery(query.id, {
        text: "No device connected.",
        show_alert: true,
      });
      return;
    }
    const fileName = data.replace("play:", "");
    const soundPath = path.join(soundsDir, fileName);
    if (!fs.existsSync(soundPath)) {
      await bot.answerCallbackQuery(query.id, {
        text: "Sound not found.",
        show_alert: true,
      });
      return;
    }
    connectedSocket.send(
      JSON.stringify({
        type: "play",
        url: `/sounds/${fileName}`,
      })
    );
    await bot.answerCallbackQuery(query.id, { text: "Playing sound." });
    return;
  }
  await bot.answerCallbackQuery(query.id, { text: "Unknown action." });
});

bot.on("message", async (msg) => {
  logUpdate("message", msg);
  const chatId = msg.chat.id;

  if (msg.audio && msg.audio.file_id) {
    await handleSoundUpload(msg, msg.audio.file_id, msg.audio.file_name || "");
    return;
  }

  if (msg.document && msg.document.file_id) {
    await handleSoundUpload(msg, msg.document.file_id, msg.document.file_name || "");
    return;
  }

  if (pendingLabels.has(chatId) && msg.text) {
    const { tempPath } = pendingLabels.get(chatId);
    pendingLabels.delete(chatId);
    const fileBase = safeFilename(msg.text);
    const finalPath = path.join(soundsDir, `${fileBase}.mp3`);
    try {
      await fs.promises.rename(tempPath, finalPath);
      await bot.sendMessage(chatId, `Saved sound as ${fileBase}.`);
      await sendSoundKeyboard(chatId);
    } catch (error) {
      await bot.sendMessage(chatId, `Failed to save sound: ${error.message}`);
    }
    return;
  }

  await bot.sendMessage(chatId, "Got it! Send an MP3 or press a sound button.");
});

bot.on("polling_error", (error) => {
  logUpdate("polling_error", { message: error.message });
  console.error("Polling error:", error.message);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
