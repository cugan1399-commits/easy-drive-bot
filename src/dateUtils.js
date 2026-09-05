// Сервер (например, Render) может работать в UTC, а инструктор и ученики — по Москве (UTC+3).
// Раньше "сегодня"/"через N часов" считались через голый new Date() — то есть по времени
// сервера, а не по местному времени. Из-за этого вечером/ночью по местному времени сервер
// ещё думал, что идёт вчерашний день (UTC ещё не долистал до полуночи).
// Все даты/часы в проекте теперь считаем строго через этот модуль.
const APP_TIMEZONE = "Europe/Moscow";
const APP_UTC_OFFSET = "+03:00"; // Москва не переходит на летнее/зимнее время — смещение фиксированное

// "YYYY-MM-DD" — сегодняшняя дата по местному времени, а не по времени сервера
function todayDateString() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(new Date());
}

// "YYYY-MM-DD" для сегодня+N дней (N может быть отрицательным), тоже по местному времени
function dateStringOffset(daysFromToday) {
  const [y, m, d] = todayDateString().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + daysFromToday);
  return dt.toISOString().slice(0, 10);
}

// "YYYY-MM" — текущий месяц по местному времени (для дефолтного месяца в календаре/статистике)
function currentMonthString() {
  return todayDateString().slice(0, 7);
}

// Текущий час (0-23) по местному времени — используется cron-джобом для проверки "уже 22:00?"
function currentHour() {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIMEZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date())
  );
}

// Собирает точный момент начала занятия, считая slotDate/slotTime временем Москвы —
// а не временем сервера, как было бы при обычном new Date(`${slotDate}T${slotTime}`)
function toAppDateTime(slotDate, slotTime) {
  return new Date(`${slotDate}T${slotTime}:00${APP_UTC_OFFSET}`);
}

module.exports = {
  APP_TIMEZONE,
  APP_UTC_OFFSET,
  todayDateString,
  dateStringOffset,
  currentMonthString,
  currentHour,
  toAppDateTime,
};
