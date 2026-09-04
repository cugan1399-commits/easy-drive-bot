const express = require("express");
const { verifyInitData } = require("./telegramAuth");
const { FIXED_HOURS } = require("./constants");
const {
  getScheduleStatus,
  reconcileSlots,
  getStudentsForBroadcast,
  getDaySlots,
} = require("./db");

const INSTRUCTOR_TELEGRAM_ID = Number(process.env.INSTRUCTOR_TELEGRAM_ID);

function dateStringOffset(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function isValidDateNotInPast(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  return dateStr >= dateStringOffset(0); // сегодня или позже — прошлое публиковать нельзя
}

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

  // Быстрые ссылки на ближайшие даты — фронт сам решает, как подписать (Сегодня/Завтра/число)
  router.get("/quick-dates", (_req, res) => {
    const dates = [0, 1, 2, 3, 4].map((offset) => dateStringOffset(offset));
    res.json({ dates });
  });

  router.get("/hours", (_req, res) => {
    res.json({ hours: FIXED_HOURS });
  });

  // Состояние конкретной даты: что уже опубликовано/занято по каждому фикс. часу
  router.get("/schedule", async (req, res) => {
    try {
      const slotDate = req.query.date;
      if (!isValidDateNotInPast(slotDate)) {
        return res.status(400).json({ error: "Некорректная или прошедшая дата" });
      }

      const statusByTime = await getScheduleStatus({
        instructorId: INSTRUCTOR_TELEGRAM_ID,
        slotDate,
      });

      const hours = FIXED_HOURS.map((time) => ({
        time,
        status: statusByTime[time] || "not_published",
      }));

      const isPublished = hours.some((h) => h.status !== "not_published");
      res.json({ slotDate, hours, isPublished });
    } catch (err) {
      console.error("Ошибка получения статуса расписания:", err);
      res.status(500).json({ error: "Не получилось загрузить расписание" });
    }
  });

  // Публикация/редактирование расписания на выбранную дату
  router.post("/publish", async (req, res) => {
    try {
      const { date, times } = req.body;
      if (!isValidDateNotInPast(date)) {
        return res.status(400).json({ error: "Некорректная или прошедшая дата" });
      }
      if (!Array.isArray(times)) {
        return res.status(400).json({ error: "times должен быть массивом (можно пустым)" });
      }
      const invalid = times.filter((t) => !FIXED_HOURS.includes(t));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Недопустимые часы: ${invalid.join(", ")}` });
      }

      const result = await reconcileSlots({
        instructorId: INSTRUCTOR_TELEGRAM_ID,
        slotDate: date,
        desiredHours: times,
      });

      let notified = 0;
      if (result.added.length > 0) {
        const students = await getStudentsForBroadcast(INSTRUCTOR_TELEGRAM_ID);
        const text = result.wasEmpty
          ? `Запись на ${date} открыта! 🚗 Открывай приложение и выбирай время.`
          : `На ${date} появились новые свободные часы: ${result.added.join(", ")} 🚗`;

        const results = await Promise.allSettled(
          students.map((s) => bot.api.sendMessage(s.telegram_id, text))
        );
        notified = results.filter((r) => r.status === "fulfilled").length;
      }

      res.json({
        ok: true,
        slotDate: date,
        added: result.added,
        removed: result.removed,
        notified,
      });
    } catch (err) {
      console.error("Ошибка публикации расписания:", err);
      res.status(500).json({ error: "Не получилось опубликовать расписание" });
    }
  });

  router.get("/day", async (req, res) => {
    try {
      const slotDate = req.query.date || dateStringOffset(1);
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
