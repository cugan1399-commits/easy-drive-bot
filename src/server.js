require("dotenv").config();
const path = require("path");
const express = require("express");
const bot = require("./bot");
const { createAdminRouter } = require("./adminApi");

const app = express();
const PORT = process.env.PORT || 3000;

// Render должен видеть открытый порт, иначе решит, что сервис не поднялся
app.get("/", (_req, res) => {
  res.send("auto-school-bot: OK");
});

app.get("/health", (_req, res) => {
  res.send("auto-school-bot: OK");
});

// Mini App инструктора — статичный HTML/JS, открывается кнопкой в боте
app.use("/admin", express.static(path.join(__dirname, "..", "public", "admin")));

// API, которым пользуется Mini App
app.use("/api/admin", createAdminRouter({ bot, botToken: process.env.BOT_TOKEN }));

app.listen(PORT, () => {
  console.log(`HTTP-сервер запущен на порту ${PORT}`);
});

// Пока используем long polling — просто и достаточно для Куска 1.
// На вебхук переходим позже, когда добавим Mini App и захотим экономить ресурсы.
//
// drop_pending_updates: true — при каждом старте сервера сбрасывает всё, что
// накопилось в очереди Telegram, пока бот был выключен/падал. Это лечит
// ситуацию "бот молчит после перезапуска" из-за старых зависших апдейтов.
bot.start({
  drop_pending_updates: true,
  onStart: (botInfo) => {
    console.log(`Бот @${botInfo.username} запущен (long polling, очередь очищена)`);
  },
});
