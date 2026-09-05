const express = require("express");
const { verifyInitData } = require("./telegramAuth");
const { FIXED_HOURS } = require("./constants");
const {
  getScheduleStatus,
  reconcileSlots,
  getStudentsForBroadcast,
  getDaySlots,
  getAllStudents,
  getStudentHistoryForInstructor,
  getCompletedCountForMonth,
  markNoShow,
} = require("./db");
const { dateStringOffset, currentMonthString } = require("./dateUtils");

function isValidMonth(monthStr) {
  return /^\d{4}-\d{2}$/.test(monthStr);
}

function monthRange(monthStr) {
  const [year, month] = monthStr.split("-").map(Number);
  const start = `${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

const INSTRUCTOR_TELEGRAM_ID = Number(process.env.INSTRUCTOR_TELEGRAM_ID);

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

  // Сообщение конкретному ученику через бота (замена нерабочей ссылке t.me/<id> —
  // Telegram не открывает личный чат по числовому id, только по @username)
  router.post("/message-student", async (req, res) => {
    try {
      const { studentTelegramId, text } = req.body;
      if (!studentTelegramId || !text || !text.trim()) {
        return res.status(400).json({ error: "Нужны studentTelegramId и text" });
      }
      await bot.api.sendMessage(studentTelegramId, `✉️ Сообщение от инструктора:\n${text.trim()}`);
      res.json({ ok: true });
    } catch (err) {
      console.error("Ошибка отправки сообщения ученику:", err);
      res.status(500).json({ error: "Не получилось отправить сообщение" });
    }
  });

  // --- Вкладка "База и счётчик" ---

  // Список всех учеников этого инструктора
  router.get("/students", async (_req, res) => {
    try {
      const students = await getAllStudents({ instructorId: INSTRUCTOR_TELEGRAM_ID });
      res.json({ students });
    } catch (err) {
      console.error("Ошибка получения списка учеников:", err);
      res.status(500).json({ error: "Не получилось загрузить список учеников" });
    }
  });

  // История занятий конкретного ученика (для карточки при клике в списке)
  router.get("/students/:studentId/history", async (req, res) => {
    try {
      const studentTelegramId = Number(req.params.studentId);
      if (!studentTelegramId) {
        return res.status(400).json({ error: "Некорректный id ученика" });
      }

      const history = await getStudentHistoryForInstructor({
        instructorId: INSTRUCTOR_TELEGRAM_ID,
        studentTelegramId,
      });
      res.json({ history });
    } catch (err) {
      console.error("Ошибка получения истории ученика:", err);
      res.status(500).json({ error: "Не получилось загрузить историю ученика" });
    }
  });

  // Счётчик: сколько занятий реально проведено (completed, без no_show) за выбранный месяц
  router.get("/stats", async (req, res) => {
    try {
      const month = isValidMonth(req.query.month) ? req.query.month : currentMonthString();
      const { start, end } = monthRange(month);

      const completedCount = await getCompletedCountForMonth({
        instructorId: INSTRUCTOR_TELEGRAM_ID,
        monthStart: start,
        monthEnd: end,
      });

      res.json({ month, completedCount });
    } catch (err) {
      console.error("Ошибка получения статистики:", err);
      res.status(500).json({ error: "Не получилось загрузить статистику" });
    }
  });

  // Пометить проведённое занятие как "не было" — не должно учитываться в счётчике
  router.post("/history/:historyId/no-show", async (req, res) => {
    try {
      const historyId = Number(req.params.historyId);
      if (!historyId) {
        return res.status(400).json({ error: "Некорректный id записи" });
      }

      const updated = await markNoShow({ historyId, instructorId: INSTRUCTOR_TELEGRAM_ID });
      if (!updated) {
        return res.status(404).json({ error: "Запись не найдена или уже не 'completed'" });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Ошибка отметки no-show:", err);
      res.status(500).json({ error: "Не получилось отметить занятие" });
    }
  });

  // Массовая рассылка своим ученикам (реклама акций/окон и т.п.).
  // Уходит только тем, у кого включены уведомления — как и обычные пуши о расписании.
  router.post("/broadcast", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim()) {
        return res.status(400).json({ error: "Текст рассылки не может быть пустым" });
      }

      const students = await getStudentsForBroadcast(INSTRUCTOR_TELEGRAM_ID);
      const results = await Promise.allSettled(
        students.map((s) => bot.api.sendMessage(s.telegram_id, text.trim()))
      );
      const notified = results.filter((r) => r.status === "fulfilled").length;

      res.json({ ok: true, notified, total: students.length });
    } catch (err) {
      console.error("Ошибка массовой рассылки:", err);
      res.status(500).json({ error: "Не получилось отправить рассылку" });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
