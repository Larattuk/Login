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

const connectedDevices = new Map();
let connectedAt = null;
let activeDeviceId = null;
let awaitingAddUpload = false;
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

const detectDeviceNameFromUA = (ua = "") => {
  if (/iPhone/i.test(ua)) {
    return "iPhone";
  }
  if (/iPad/i.test(ua)) {
    return "iPad";
  }
  if (/Android/i.test(ua)) {
    return "Android Phone";
  }
  if (/Macintosh|Mac OS X/i.test(ua)) {
    return "Mac";
  }
  if (/Windows/i.test(ua)) {
    return "Windows PC";
  }
  return "device";
};

const getSoundFiles = () =>
  fs.readdirSync(soundsDir).filter((file) => file.toLowerCase().endsWith(".mp3"));

const listSoundButtons = () => {
  const files = getSoundFiles();
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

const listDeviceButtons = () => {
  const devices = Array.from(connectedDevices.values());
  if (!devices.length) {
    return null;
  }

  return {
    inline_keyboard: [
      ...devices.map((device) => {
        const activeMark = device.id === activeDeviceId ? "✅ " : "";
        return [
          {
            text: `${activeMark}${device.name}`,
            callback_data: `select-device:${device.id}`,
          },
        ];
      }),
      [{ text: "Play on all devices", callback_data: "select-device:all" }],
      [{ text: "Disconnect active", callback_data: "disconnect" }],
    ],
  };
};

const sendOwnerMessage = async (text, options = {}) => {
  try {
    await bot.sendMessage(OWNER_CHAT_ID, text, options);
  } catch (error) {
    console.error("Failed to send owner message:", error.message);
  }
};

const getActiveDevices = () => {
  if (!connectedDevices.size) {
    return [];
  }
  if (activeDeviceId && connectedDevices.has(activeDeviceId)) {
    return [connectedDevices.get(activeDeviceId)];
  }
  return Array.from(connectedDevices.values());
};

const notifyDeviceConnected = async (device) => {
  const keyboard = listDeviceButtons();
  await sendOwnerMessage(
    `Device connected: ${device.name}. Total connected: ${connectedDevices.size}.`,
    keyboard ? { reply_markup: keyboard } : {}
  );
};

const disconnectActiveDevice = () => {
  if (!connectedDevices.size) {
    return false;
  }

  if (activeDeviceId && connectedDevices.has(activeDeviceId)) {
    const device = connectedDevices.get(activeDeviceId);
    device.socket.close(1000, "Disconnected by owner");
    connectedDevices.delete(activeDeviceId);
  } else {
    const firstDevice = connectedDevices.values().next().value;
    if (firstDevice) {
      firstDevice.socket.close(1000, "Disconnected by owner");
      connectedDevices.delete(firstDevice.id);
    }
  }

  if (connectedDevices.size === 0) {
    activeDeviceId = null;
    connectedAt = null;
  } else if (!activeDeviceId || !connectedDevices.has(activeDeviceId)) {
    activeDeviceId = Array.from(connectedDevices.keys())[0];
  }

  return true;
};

wss.on("connection", (socket, req) => {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  const rawName = (url.searchParams.get("device") || "").trim();
  const uaName = detectDeviceNameFromUA(req.headers["user-agent"] || "");
  const fallbackName = `${uaName}-${connectedDevices.size + 1}`;
  const deviceName = rawName || fallbackName;
  const deviceId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const device = {
    id: deviceId,
    name: deviceName,
    socket,
    connectedAt: new Date().toISOString(),
  };

  connectedDevices.set(deviceId, device);
  if (!connectedAt) {
    connectedAt = new Date();
  }
  if (!activeDeviceId) {
    activeDeviceId = deviceId;
  }

  notifyDeviceConnected(device);

  socket.on("close", () => {
    connectedDevices.delete(deviceId);
    if (!connectedDevices.size) {
      connectedAt = null;
      activeDeviceId = null;
      return;
    }
    if (activeDeviceId === deviceId) {
      activeDeviceId = Array.from(connectedDevices.keys())[0];
    }
  });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin/status", (req, res) => {
  res.json({
    connected: connectedDevices.size > 0,
    connectedCount: connectedDevices.size,
    activeDeviceId,
    devices: Array.from(connectedDevices.values()).map((device) => ({
      id: device.id,
      name: device.name,
      connectedAt: device.connectedAt,
      isActive: device.id === activeDeviceId,
    })),
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
  if (!awaitingAddUpload) {
    await bot.sendMessage(
      msg.chat.id,
      "Use /add first, then send MP3. This protects from accidental uploads."
    );
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
    awaitingAddUpload = false;
    await askForLabel(msg.chat.id);
  } catch (error) {
    awaitingAddUpload = false;
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

const sendDeviceKeyboard = async (chatId) => {
  const keyboard = listDeviceButtons();
  if (!keyboard) {
    await bot.sendMessage(chatId, "No devices connected now.");
    return;
  }

  const selectedLabel =
    activeDeviceId && connectedDevices.has(activeDeviceId)
      ? connectedDevices.get(activeDeviceId).name
      : "all devices";

  await bot.sendMessage(chatId, `Connected devices. Selected: ${selectedLabel}.`, {
    reply_markup: keyboard,
  });
};

bot.onText(/\/start/, async (msg) => {
  logUpdate("command", msg);
  await bot.sendMessage(
    msg.chat.id,
    "Soundboard bot ready. Commands: /device, /add, /del <name>."
  );
  await sendSoundKeyboard(msg.chat.id);
});

bot.onText(/\/device/, async (msg) => {
  logUpdate("command", msg);
  await sendDeviceKeyboard(msg.chat.id);
});

bot.onText(/\/add/, async (msg) => {
  logUpdate("command", msg);
  if (String(msg.chat.id) !== String(OWNER_CHAT_ID)) {
    await bot.sendMessage(msg.chat.id, "Only the owner can add sounds.");
    return;
  }
  awaitingAddUpload = true;
  await bot.sendMessage(msg.chat.id, "Send MP3 now. Upload mode enabled for one file.");
});

bot.onText(/\/del(?:\s+(.+))?/, async (msg, match) => {
  logUpdate("command", msg);
  if (String(msg.chat.id) !== String(OWNER_CHAT_ID)) {
    await bot.sendMessage(msg.chat.id, "Only the owner can delete sounds.");
    return;
  }

  const rawName = (match && match[1] ? match[1] : "").trim();
  if (!rawName) {
    await bot.sendMessage(msg.chat.id, "Usage: /del name_song");
    return;
  }

  const soundName = rawName.toLowerCase().endsWith(".mp3") ? rawName : `${rawName}.mp3`;
  const soundPath = path.join(soundsDir, soundName);
  if (!fs.existsSync(soundPath)) {
    await bot.sendMessage(msg.chat.id, `Sound not found: ${soundName}`);
    return;
  }

  await fs.promises.unlink(soundPath);
  await bot.sendMessage(msg.chat.id, `Deleted sound: ${soundName}`);
});

bot.on("callback_query", async (query) => {
  logUpdate("callback_query", query);
  const data = query.data || "";

  if (data === "disconnect") {
    const disconnected = disconnectActiveDevice();
    await bot.answerCallbackQuery(query.id, {
      text: disconnected ? "Device disconnected." : "No device connected.",
    });
    if (disconnected) {
      await sendOwnerMessage("Active device disconnected.");
    }
    return;
  }

  if (data.startsWith("select-device:")) {
    const selected = data.replace("select-device:", "");
    if (selected === "all") {
      activeDeviceId = null;
      await bot.answerCallbackQuery(query.id, {
        text: "Selected all devices.",
      });
      return;
    }
    if (!connectedDevices.has(selected)) {
      await bot.answerCallbackQuery(query.id, {
        text: "Device is offline.",
        show_alert: true,
      });
      return;
    }
    activeDeviceId = selected;
    await bot.answerCallbackQuery(query.id, {
      text: `Selected: ${connectedDevices.get(selected).name}`,
    });
    return;
  }

  if (data.startsWith("play:")) {
    const targets = getActiveDevices();
    if (!targets.length) {
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

    const payload = JSON.stringify({
      type: "play",
      url: `/sounds/${fileName}`,
    });

    targets.forEach((device) => {
      if (device.socket.readyState === WebSocket.OPEN) {
        device.socket.send(payload);
      }
    });

    await bot.answerCallbackQuery(query.id, {
      text: `Playing on ${targets.length} device(s).`,
    });
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

  if (pendingLabels.has(chatId) && msg.text && !msg.text.startsWith("/")) {
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

  if (msg.text && msg.text.startsWith("/")) {
    return;
  }

  await bot.sendMessage(chatId, "Got it! Use /add to upload or press a sound button.");
});

bot.on("polling_error", (error) => {
  logUpdate("polling_error", { message: error.message });
  console.error("Polling error:", error.message);
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
