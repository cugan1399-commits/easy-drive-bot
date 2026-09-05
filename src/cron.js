const { completePastSlots } = require("./db");
const { todayDateString, currentHour } = require("./dateUtils");

// Дата (YYYY-MM-DD по местному времени), для которой автозавершение уже прогонялось сегодня —
// защита от повторного запуска на каждом тике интервала.
let lastCompletedDate = null;

async function runAutoComplete() {
  const cutoffDate = todayDateString(); // "сегодня" строго по местному времени (Europe/Moscow), не по времени сервера
  try {
    const movedCount = await completePastSlots({ cutoffDate });
    if (movedCount > 0) {
      console.log(`Автозавершение: ${movedCount} занятий перенесено в history (cutoff: ${cutoffDate}).`);
    }
  } catch (err) {
    console.error("Автозавершение: ошибка вызова complete_past_slots:", err);
  }
}

function startAutoCompleteCron() {
  // Проверяем каждые 15 минут, наступило ли 22:00 по местному времени и не гоняли ли
  // автозавершение уже сегодня. currentHour()/todayDateString() считают время по
  // Europe/Moscow независимо от того, в каком часовом поясе физически работает сервер.
  setInterval(() => {
    const todayStr = todayDateString();
    if (currentHour() >= 22 && lastCompletedDate !== todayStr) {
      lastCompletedDate = todayStr;
      runAutoComplete();
    }
  }, 15 * 60 * 1000);

  // Если сервер стартовал уже после 22:00 (например, после деплоя или "просыпания" на
  // Render) — не ждём следующего тика интервала, прогоняем сразу при старте.
  if (currentHour() >= 22) {
    lastCompletedDate = todayDateString();
    runAutoComplete();
  }
}

module.exports = { startAutoCompleteCron, runAutoComplete };
