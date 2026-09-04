const express = require("express");
const { requireRegisteredUser } = require("./commonApi");
const { FIXED_HOURS } = require("./constants");
const { getStudentSlotsView, bookSlots } = require("./db");

function tomorrowDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
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

  return router;
}

module.exports = { createStudentRouter };
