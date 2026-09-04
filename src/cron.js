const { supabase } = require("./db");

// Дата (YYYY-MM-DD), для которой автозавершение уже прогонялось сегодня —
// защита от повторного запуска на каждом тике интервала.
let lastCompletedDate = null;

// Переносит все прошедшие занятые слоты в history как 'completed' и убирает их из slots.
// Идемпотентно: если запустить дважды подряд, второй раз просто ничего не найдёт.
// Условие "slot_date <= сегодня" (а не только "вчера") специально ловит и те дни,
// когда сервер спал/падал ровно в момент 22:00 — при следующем успешном запуске
// пропущенные дни всё равно подчистятся.
async function completePastSlots() {
  const todayStr = new Date().toISOString().slice(0, 10);

  const { data: pastSlots, error: eSelect } = await supabase
    .from("slots")
    .select("id, instructor_id, user_id, slot_date, slot_time")
    .eq("status", "busy")
    .lte("slot_date", todayStr);

  if (eSelect) {
    console.error("Автозавершение: ошибка выборки прошедших слотов:", eSelect);
    return;
  }
  if (!pastSlots || pastSlots.length === 0) return;

  const historyRows = pastSlots.map((s) => ({
    instructor_id: s.instructor_id,
    user_id: s.user_id,
    date: s.slot_date,
    time: s.slot_time,
    status: "completed",
  }));

  const { error: eInsert } = await supabase.from("history").insert(historyRows);
  if (eInsert) {
    // Не удаляем слоты, если запись в history не удалась — лучше повторить попытку
    // на следующем тике, чем молча потерять занятия из статистики.
    console.error("Автозавершение: ошибка записи в history, слоты не тронуты:", eInsert);
    return;
  }

  const { error: eDelete } = await supabase
    .from("slots")
    .delete()
    .in("id", pastSlots.map((s) => s.id));

  if (eDelete) {
    console.error("Автозавершение: history записан, но не удалось удалить обработанные слоты:", eDelete);
    return;
  }

  console.log(`Автозавершение: ${pastSlots.length} занятий перенесено в history.`);
}

function startAutoCompleteCron() {
  // Проверяем каждые 15 минут, наступило ли 22:00 и не гоняли ли автозавершение уже сегодня.
  setInterval(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (now.getHours() >= 22 && lastCompletedDate !== todayStr) {
      lastCompletedDate = todayStr;
      completePastSlots();
    }
  }, 15 * 60 * 1000);

  // Если сервер стартовал уже после 22:00 (например, после деплоя или сна на Render) —
  // не ждём следующего тика интервала, прогоняем сразу при старте.
  const now = new Date();
  if (now.getHours() >= 22) {
    lastCompletedDate = now.toISOString().slice(0, 10);
    completePastSlots();
  }
}

module.exports = { startAutoCompleteCron, completePastSlots };
