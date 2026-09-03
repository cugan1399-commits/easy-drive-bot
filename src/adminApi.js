const express = require("express");
const { verifyInitData } = require("./telegramAuth");
const { FIXED_HOURS } = require("./constants");
const {
  publishTomorrowSlots,
  getStudentsForBroadcast,
  getDaySlots,
} = require("./db");

const INSTRUCTOR_TELEGRAM_ID = Number(process.env.INSTRUCTOR_TELEGRAM_ID);

function tomorrowDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Общий middleware: проверяет initData и что этот пользователь — инструктор.
// Кладёт проверенный telegram_id в req.telegramId.
function requireAdmin(botToken) {
  return (req, res, next) => {
    const initData = req.headers["x-telegram-init-data"];
    const result = verifyInitData(initData, botToken);

    if (!result.ok || !result.user) {
      return res.status(401).json({ error: "Не удалось подтвердить пользователя Telegram" });
    }
    if (result.user.id !== INSTRUCTOR_TELEGRAM_ID) {
      return res.status(403).json({ error: "Доступ только для инструктора" });
    }

    req.telegramId = result.user.id;
    next();
  };
}

function createAdminRouter({ bot, botToken }) {
  const router = express.Router();
  router.use(express.json());
  router.use(requireAdmin(botToken));

  // Список стандартных часов — фронтенду нужно знать, что рисовать кнопками
  router.get("/hours", (_req, res) => {
    res.json({ hours: FIXED_HOURS });
  });

  // Публикация выбранных часов на завтра + рассылка ученикам
  router.post("/publish", async (req, res) => {
    try {
      const { times } = req.body; // массив выбранных часов, например ["09:00","10:00"]
      if (!Array.isArray(times) || times.length === 0) {
        return res.status(400).json({ error: "Не выбрано ни одного часа" });
      }

      const invalid = times.filter((t) => !FIXED_HOURS.includes(t));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Недопустимые часы: ${invalid.join(", ")}` });
      }

      const slotDate = tomorrowDateString();
      await publishTomorrowSlots({
        instructorId: INSTRUCTOR_TELEGRAM_ID,
        times,
        slotDate,
      });

      const students = await getStudentsForBroadcast(INSTRUCTOR_TELEGRAM_ID);
      const results = await Promise.allSettled(
        students.map((s) =>
          bot.api.sendMessage(s.telegram_id, "Запись на завтра открыта! 🚗 Открывай приложение и выбирай время.")
        )
      );
      const failedCount = results.filter((r) => r.status === "rejected").length;

      res.json({
        ok: true,
        publishedHours: times,
        slotDate,
        notified: students.length - failedCount,
        failedToNotify: failedCount,
      });
    } catch (err) {
      console.error("Ошибка публикации расписания:", err);
      res.status(500).json({ error: "Не получилось опубликовать расписание" });
    }
  });

  // "Мой День" — список слотов на конкретную дату (по умолчанию — завтра)
  router.get("/day", async (req, res) => {
    try {
      const slotDate = req.query.date || tomorrowDateString();
      const slots = await getDaySlots({
        instructorId: INSTRUCTOR_TELEGRAM_ID,
        slotDate,
      });
      res.json({ slotDate, slots });
    } catch (err) {
      console.error("Ошибка получения расписания дня:", err);
      res.status(500).json({ error: "Не получилось загрузить расписание" });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
