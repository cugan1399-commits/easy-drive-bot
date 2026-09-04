const { createClient } = require("@supabase/supabase-js");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY не заданы в .env");
}

// service_role key — сервер доверенный, работает от имени бэкенда, а не конечного юзера
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getUserByTelegramId(telegramId) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  if (error) throw error;
  return data; // null, если не найден
}

async function createUser({ telegramId, name, phone, instructorId, isAdmin = false }) {
  const { data, error } = await supabase
    .from("users")
    .insert({
      telegram_id: telegramId,
      name,
      phone,
      instructor_id: isAdmin ? null : instructorId,
      is_admin: isAdmin,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getScheduleStatus({ instructorId, slotDate }) {
  // Текущее состояние конкретной даты: что уже опубликовано/занято/ещё не тронуто.
  const { data, error } = await supabase
    .from("slots")
    .select("slot_time, status")
    .eq("instructor_id", instructorId)
    .eq("slot_date", slotDate);

  if (error) throw error;

  const byTime = Object.fromEntries(data.map((row) => [row.slot_time.slice(0, 5), row.status]));
  return byTime; // { "10:00": "free", "11:00": "busy", ... } — часов, которых тут нет, ещё не публиковали
}

async function reconcileSlots({ instructorId, slotDate, desiredHours }) {
  // Приводит расписание дня к желаемому набору часов:
  // - новые часы из desiredHours создаются свободными
  // - часы, которые были свободны, но их убрали из desiredHours — удаляются
  // - занятые (status='busy') часы НИКОГДА не трогаем, даже если их нет в desiredHours
  const { data: current, error: e1 } = await supabase
    .from("slots")
    .select("id, slot_time, status")
    .eq("instructor_id", instructorId)
    .eq("slot_date", slotDate);
  if (e1) throw e1;

  const currentByTime = Object.fromEntries(current.map((r) => [r.slot_time.slice(0, 5), r]));
  const desiredSet = new Set(desiredHours);
  const wasEmpty = current.length === 0;

  const toInsert = desiredHours
    .filter((h) => !currentByTime[h])
    .map((slot_time) => ({ instructor_id: instructorId, slot_date: slotDate, slot_time, status: "free" }));

  const toDelete = current.filter((r) => r.status === "free" && !desiredSet.has(r.slot_time.slice(0, 5)));

  if (toDelete.length > 0) {
    const { error: eDel } = await supabase
      .from("slots")
      .delete()
      .in("id", toDelete.map((r) => r.id));
    if (eDel) throw eDel;
  }
  if (toInsert.length > 0) {
    const { error: eIns } = await supabase.from("slots").insert(toInsert);
    if (eIns) throw eIns;
  }

  return {
    wasEmpty,
    added: toInsert.map((r) => r.slot_time),
    removed: toDelete.map((r) => r.slot_time.slice(0, 5)),
  };
}

async function getStudentsForBroadcast(instructorId) {
  const { data, error } = await supabase
    .from("users")
    .select("telegram_id")
    .eq("instructor_id", instructorId)
    .eq("notification_enabled", true)
    .eq("is_admin", false);

  if (error) throw error;
  return data;
}

async function getDaySlots({ instructorId, slotDate }) {
  // join со студентом, чтобы сразу получить имя/телефон занявшего слот
  const { data, error } = await supabase
    .from("slots")
    .select("id, slot_time, status, user_id, users:user_id (name, phone)")
    .eq("instructor_id", instructorId)
    .eq("slot_date", slotDate)
    .order("slot_time", { ascending: true });

  if (error) throw error;
  return data;
}

async function getStudentSlotsView({ instructorId, slotDate }) {
  // Студенту не нужно чужое имя/телефон — только время и статус
  const { data, error } = await supabase
    .from("slots")
    .select("slot_time, status")
    .eq("instructor_id", instructorId)
    .eq("slot_date", slotDate)
    .order("slot_time", { ascending: true });

  if (error) throw error;
  return data;
}

async function bookSlots({ instructorId, userId, slotDate, times }) {
  const { data, error } = await supabase.rpc("book_slots", {
    p_instructor_id: instructorId,
    p_user_id: userId,
    p_slot_date: slotDate,
    p_slot_times: times,
  });

  if (error) throw error; // текст ошибки содержит SLOT_TAKEN:HH:MM или SLOT_NOT_FOUND:HH:MM
  return data;
}

module.exports = {
  supabase,
  getUserByTelegramId,
  createUser,
  getScheduleStatus,
  reconcileSlots,
  getStudentsForBroadcast,
  getDaySlots,
  getStudentSlotsView,
  bookSlots,
};
