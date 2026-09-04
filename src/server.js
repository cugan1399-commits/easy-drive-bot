require("dotenv").config();
const path = require("path");
const express = require("express");
const bot = require("./bot");
const { createAdminRouter } = require("./adminApi");
const { createCommonRouter } = require("./commonApi");
const { createStudentRouter } = require("./studentApi");
const { startAutoCompleteCron } = require("./cron");

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

// Кусок 4: ежедневное автозавершение прошедших занятий (перенос в history) в 22:00
startAutoCompleteCron();

// Пока используем long polling — просто и достаточно для Куска 1.
// На вебхук переходим позже, когда добавим Mini App и захотим экономить ресурсы.
//
// drop_pending_updates: true — при каждом старте сервера сбрасывает всё, что
// накопилось в очереди Telegram, пока бот был выключен/падал. Это лечит
// ситуацию "бот молчит после перезапуска" из-за старых зависших апдейтов.
//
// При деплое на Render старый и новый процесс могут секунду-две существовать
// одновременно — Telegram в этот момент отвечает 409 Conflict. Раньше это
// валило весь процесс; теперь просто ждём и пробуем снова, пока старый
// инстанс не отключится сам.
async function startBotWithRetry(attempt = 1) {
  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: (botInfo) => {
        console.log(`Бот @${botInfo.username} запущен (long polling, очередь очищена)`);
      },
    });
  } catch (err) {
    const isConflict = err?.error_code === 409;
    if (isConflict && attempt <= 10) {
      const delayMs = Math.min(5000 * attempt, 30000);
      console.warn(
        `409 Conflict при старте бота (скорее всего, старый инстанс ещё не отключился). Повтор через ${delayMs / 1000}с, попытка ${attempt}/10...`
      );
      setTimeout(() => startBotWithRetry(attempt + 1), delayMs);
    } else {
      console.error("Не удалось запустить бота:", err);
      process.exit(1); // если это не 409 или попытки кончились — падаем по-настоящему
    }
  }
}

startBotWithRetry();
