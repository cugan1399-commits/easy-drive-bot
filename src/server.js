require("dotenv").config();
const path = require("path");
const express = require("express");
const bot = require("./bot");
const { createAdminRouter } = require("./adminApi");
const { createCommonRouter } = require("./commonApi");
const { createStudentRouter } = require("./studentApi");

const app = express();
const PORT = process.env.PORT || 3000;

// Render должен видеть открытый порт, иначе решит, что сервис не поднялся
app.get("/", (_req, res) => {
  res.send("auto-school-bot: OK");
});

app.get("/health", (_req, res) => {
  res.send("auto-school-bot: OK");
});

// Единая Mini App — сама решает, какой экран показать (инструктор/ученик)
app.use("/app", express.static(path.join(__dirname, "..", "public", "app")));
// Старый путь оставлен рабочим на случай, если где-то уже сохранена ссылка
app.use("/admin", express.static(path.join(__dirname, "..", "public", "admin")));

app.use("/api", createCommonRouter({ botToken: process.env.BOT_TOKEN }));
app.use("/api/admin", createAdminRouter({ bot, botToken: process.env.BOT_TOKEN }));
app.use("/api/student", createStudentRouter({ bot, botToken: process.env.BOT_TOKEN }));

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
