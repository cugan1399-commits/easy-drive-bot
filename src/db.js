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

async function publishTomorrowSlots({ instructorId, times, slotDate }) {
  // upsert: если слот на этот час уже есть — не трогаем его (вдруг уже занят
  // с прошлой публикации), если нет — создаём свободным.
  const rows = times.map((slot_time) => ({
    instructor_id: instructorId,
    slot_date: slotDate,
    slot_time,
    status: "free",
  }));

  const { data, error } = await supabase
    .from("slots")
    .upsert(rows, {
      onConflict: "instructor_id,slot_date,slot_time",
      ignoreDuplicates: true,
    })
    .select();

  if (error) throw error;
  return data;
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

module.exports.getStudentSlotsView = getStudentSlotsView;
module.exports.bookSlots = bookSlots;
module.exports.publishTomorrowSlots = publishTomorrowSlots;
module.exports.getStudentsForBroadcast = getStudentsForBroadcast;
module.exports.getDaySlots = getDaySlots;
