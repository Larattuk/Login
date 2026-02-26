const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');

// === ВСТАВТЕ СЮДИ СВІЙ BOT_TOKEN ===
// Приклад: const BOT_TOKEN = '123456:ABC-DEF...';
const BOT_TOKEN = '8378410005:AAFX_C5igOXn5YFJQiL7U0HFKjO0DK_JaDE';

// === ВСТАВТЕ СЮДИ СВІЙ OWNER_CHAT_ID ===
// Приклад: const OWNER_CHAT_ID = '123456789';
const OWNER_CHAT_ID = '944944398';

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let connectedDevice = null;

function isBotConfigured() {
  return BOT_TOKEN && OWNER_CHAT_ID;
}

function buildSoundButtons() {
  // Додайте нові звуки тут: { label: 'Sound 3', command: 'sound3' }
  const sounds = [
    { label: 'Sound 1', command: 'sound1' },
    { label: 'Sound 2', command: 'sound2' },
  ];

  return [
    sounds.map((sound) => ({
      text: sound.label,
      callback_data: `sound:${sound.command}`,
    })),
  ];
}

function notifyOwner(deviceId) {
  if (!isBotConfigured()) {
    console.warn('BOT_TOKEN або OWNER_CHAT_ID не задані. Telegram-сповіщення вимкнені.');
    return;
  }

  bot.sendMessage(OWNER_CHAT_ID, `New device connected: ${deviceId}`, {
    reply_markup: {
      inline_keyboard: buildSoundButtons(),
    },
  });
}

wss.on('connection', (ws) => {
  let deviceId = null;
  console.log('Нове WebSocket-з’єднання. Очікується реєстрація пристрою.');

  ws.on('message', (message) => {
    const text = message.toString();
    try {
      const payload = JSON.parse(text);
      if (payload.type === 'register' && payload.deviceId) {
        deviceId = payload.deviceId;
        connectedDevice = { deviceId, socket: ws };
        console.log(`Пристрій підключився: ${deviceId}`);
        notifyOwner(deviceId);
        return;
      }
    } catch (error) {
      console.log('Не JSON-повідомлення від пристрою:', text);
    }

    console.log('Отримано від пристрою:', text);
  });

  ws.on('close', () => {
    if (connectedDevice && connectedDevice.socket === ws) {
      console.log(`Пристрій відключився: ${connectedDevice.deviceId}`);
      connectedDevice = null;
    } else {
      console.log('WebSocket-з’єднання закрито.');
    }
  });
});

bot.on('callback_query', (query) => {
  const [action, command] = (query.data || '').split(':');
  if (action !== 'sound' || !command) {
    return;
  }

  if (connectedDevice && connectedDevice.socket.readyState === WebSocket.OPEN) {
    connectedDevice.socket.send(command);
    bot.answerCallbackQuery(query.id, { text: `Команду ${command} надіслано.` });
  } else {
    bot.answerCallbackQuery(query.id, { text: 'Пристрій не підключений.' });
  }
});

server.listen(PORT, () => {
  console.log(`Сервер запущено на http://localhost:${PORT}`);
  console.log('Відкрийте index.html на пристрої через цей сервер.');
});

/*
Коротка інструкція запуску:
1) Встановіть залежності: npm install express ws node-telegram-bot-api
2) Запустіть сервер: node server.js
3) Відкрийте сайт на пристрої: http://<IP_ПК>:3000 та натисніть "Connect Device".
4) Бот надішле повідомлення OWNER_CHAT_ID, коли пристрій підключиться.
5) Натисніть кнопку потрібного звуку в Telegram, щоб надіслати команду на підключений пристрій.
*/
