const express = require("express");
const { requireRegisteredUser } = require("./commonApi");
const { FIXED_HOURS, CANCEL_MIN_HOURS_BEFORE } = require("./constants");
const {
  getStudentSlotsView,
  bookSlots,
  getBookedSlotForStudent,
  getUpcomingBookingsForStudent,
  cancelBooking,
  getStudentHistory,
  updateUserProfile,
} = require("./db");
const { dateStringOffset, currentMonthString, toAppDateTime } = require("./dateUtils");

function isValidMonth(monthStr) {
  return /^\d{4}-\d{2}$/.test(monthStr);
}

function monthRange(monthStr) {
  // "2026-09" -> ["2026-09-01", "2026-09-30"]
  const [year, month] = monthStr.split("-").map(Number);
  const start = `${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate(); // month здесь 1-based из-за new Date(y, m, 0)
  const end = `${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function tomorrowDateString() {
  return dateStringOffset(1);
}

function areConsecutiveHours(times) {
  if (times.length !== 2) return true; // проверка на "подряд" актуальна только для пары часов
  const [a, b] = [...times].sort();
  const indexA = FIXED_HOURS.indexOf(a);
  const indexB = FIXED_HOURS.indexOf(b);
  return indexA !== -1 && indexB !== -1 && indexB - indexA === 1;
}

function createStudentRouter({ bot, botToken }) {
  const router = express.Router();
  router.use(express.json());
  router.use(requireRegisteredUser(botToken));

  router.get("/slots", async (req, res) => {
    try {
      const user = req.dbUser;
      if (user.is_admin) {
        return res.status(400).json({ error: "Инструктор не бронирует занятия сам себе" });
      }

      const slotDate = req.query.date || tomorrowDateString();
      const slots = await getStudentSlotsView({
        instructorId: user.instructor_id,
        slotDate,
      });
      res.json({ slotDate, slots });
    } catch (err) {
      console.error("Ошибка получения слотов для ученика:", err);
      res.status(500).json({ error: "Не получилось загрузить расписание" });
    }
  });

  router.post("/book", async (req, res) => {
    try {
      const user = req.dbUser;
      if (user.is_admin) {
        return res.status(400).json({ error: "Инструктор не бронирует занятия сам себе" });
      }

      const { times } = req.body;
      if (!Array.isArray(times) || times.length < 1 || times.length > 2) {
        return res.status(400).json({ error: "Выбери 1 или 2 часа" });
      }
      const invalid = times.filter((t) => !FIXED_HOURS.includes(t));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Недопустимые часы: ${invalid.join(", ")}` });
      }
      if (!areConsecutiveHours(times)) {
        return res.status(400).json({ error: "Два часа должны идти подряд, например 14:00 и 15:00" });
      }

      const slotDate = tomorrowDateString();

      let booked;
      try {
        booked = await bookSlots({
          instructorId: user.instructor_id,
          userId: user.telegram_id,
          slotDate,
          times,
        });
      } catch (rpcErr) {
        const msg = rpcErr.message || "";
        if (msg.includes("SLOT_TAKEN")) {
          return res.status(409).json({ error: "Это время уже занято!" });
        }
        if (msg.includes("SLOT_NOT_FOUND")) {
          return res.status(404).json({ error: "Такого слота нет в расписании" });
        }
        throw rpcErr;
      }

      // Текстовое подтверждение прямо в чат — дублирует то, что видно в Mini App
      const timesLabel = [...times].sort().join(" и ");
      await bot.api.sendMessage(user.telegram_id, `Вы записаны на завтра (${slotDate}) в ${timesLabel} ✅`);

      res.json({ ok: true, slotDate, booked: booked.map((s) => s.slot_time) });
    } catch (err) {
      console.error("Ошибка бронирования:", err);
      res.status(500).json({ error: "Не получилось записаться, попробуй ещё раз" });
    }
  });

  // --- Вкладка "Профиль" ---

  router.get("/profile", (req, res) => {
    const user = req.dbUser;
    res.json({
      name: user.name,
      phone: user.phone,
      notificationEnabled: user.notification_enabled,
    });
  });

  router.patch("/profile", async (req, res) => {
    try {
      const { name, phone, notificationEnabled } = req.body;

      if (name !== undefined && !name.trim()) {
        return res.status(400).json({ error: "Имя не может быть пустым" });
      }
      if (phone !== undefined && !phone.trim()) {
        return res.status(400).json({ error: "Телефон не может быть пустым" });
      }
      if (notificationEnabled !== undefined && typeof notificationEnabled !== "boolean") {
        return res.status(400).json({ error: "notificationEnabled должен быть true/false" });
      }

      const updated = await updateUserProfile({
        telegramId: req.dbUser.telegram_id,
        name: name?.trim(),
        phone: phone?.trim(),
        notificationEnabled,
      });

      res.json({
        ok: true,
        name: updated.name,
        phone: updated.phone,
        notificationEnabled: updated.notification_enabled,
      });
    } catch (err) {
      console.error("Ошибка обновления профиля ученика:", err);
      res.status(500).json({ error: "Не получилось сохранить профиль" });
    }
  });

  // --- Вкладка "Мои занятия" ---

  // Календарь месяца: точки по дням из history + список актуальных (незавершённых) броней
  router.get("/history", async (req, res) => {
    try {
      const user = req.dbUser;
      if (user.is_admin) {
        return res.status(400).json({ error: "У инструктора нет своего календаря занятий" });
      }

      const month = isValidMonth(req.query.month) ? req.query.month : currentMonthString();
      const { start, end } = monthRange(month);

      const history = await getStudentHistory({ userId: user.telegram_id, monthStart: start, monthEnd: end });
      res.json({ month, history });
    } catch (err) {
      console.error("Ошибка получения истории занятий ученика:", err);
      res.status(500).json({ error: "Не получилось загрузить календарь" });
    }
  });

  // Активные (ещё не проведённые) брони ученика — используется в "Мои занятия" для кнопки отмены
  router.get("/upcoming", async (req, res) => {
    try {
      const user = req.dbUser;
      if (user.is_admin) {
        return res.json({ upcoming: [] });
      }

      const upcoming = await getUpcomingBookingsForStudent({ userId: user.telegram_id });
      res.json({
        upcoming: upcoming.map((s) => ({ date: s.slot_date, time: s.slot_time.slice(0, 5) })),
      });
    } catch (err) {
      console.error("Ошибка получения активных броней ученика:", err);
      res.status(500).json({ error: "Не получилось загрузить брони" });
    }
  });

  // Отмена уже забронированного занятия — доступно не позже, чем за
  // CANCEL_MIN_HOURS_BEFORE часов до его начала.
  router.post("/cancel", async (req, res) => {
    try {
      const user = req.dbUser;
      if (user.is_admin) {
        return res.status(400).json({ error: "Инструктору нечего отменять" });
      }

      const { slotDate, slotTime, reason } = req.body;
      if (!slotDate || !slotTime) {
        return res.status(400).json({ error: "Нужны slotDate и slotTime" });
      }

      const slot = await getBookedSlotForStudent({
        userId: user.telegram_id,
        slotDate,
        slotTime,
      });
      if (!slot) {
        return res.status(404).json({ error: "Такая бронь не найдена — возможно, уже отменена" });
      }

      const lessonStart = toAppDateTime(slotDate, slotTime);
      const hoursLeft = (lessonStart.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursLeft < CANCEL_MIN_HOURS_BEFORE) {
        return res.status(409).json({
          error: `Отменить можно не позже чем за ${CANCEL_MIN_HOURS_BEFORE} ч. до занятия — время уже слишком близко`,
        });
      }

      const result = await cancelBooking({
        slotId: slot.id,
        instructorId: slot.instructor_id,
        userId: user.telegram_id,
        slotDate,
        slotTime,
        reason: reason?.trim() || null,
      });

      if (!result.ok) {
        return res.status(409).json({ error: "Эта запись уже отменена" });
      }

      // Пуш инструктору с причиной отмены
      const reasonText = reason?.trim() ? reason.trim() : "не указана";
      try {
        await bot.api.sendMessage(
          slot.instructor_id,
          `❌ ${user.name} отменил(а) занятие на ${slotDate} ${slotTime}.\nПричина: ${reasonText}`
        );
      } catch (pushErr) {
        console.error("Не удалось отправить пуш инструктору об отмене:", pushErr);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Ошибка отмены занятия:", err);
      res.status(500).json({ error: "Не получилось отменить занятие, попробуй ещё раз" });
    }
  });

  return router;
}

module.exports = { createStudentRouter };
