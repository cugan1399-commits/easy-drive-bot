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

async function saveMessageRelay(adminMessageId, studentTelegramId) {
  const { error } = await supabase
    .from("message_relay")
    .insert({ admin_message_id: adminMessageId, student_telegram_id: studentTelegramId });
  if (error) throw error;
}

async function getRelayStudentId(adminMessageId) {
  const { data, error } = await supabase
    .from("message_relay")
    .select("student_telegram_id")
    .eq("admin_message_id", adminMessageId)
    .maybeSingle();
  if (error) throw error;
  return data?.student_telegram_id || null;
}

// --- Кусок 4: отмена записи учеником ---

async function getBookedSlotForStudent({ userId, slotDate, slotTime }) {
  const { data, error } = await supabase
    .from("slots")
    .select("id, instructor_id, slot_date, slot_time, status, user_id")
    .eq("user_id", userId)
    .eq("slot_date", slotDate)
    .eq("slot_time", slotTime)
    .eq("status", "busy")
    .maybeSingle();

  if (error) throw error;
  return data; // null, если такой брони уже нет
}

async function getUpcomingBookingsForStudent({ userId }) {
  // На практике бронь всегда только на завтра (студент не выбирает дату сам),
  // но выбираем по user_id без привязки к конкретной дате — на случай,
  // если в будущем появится возможность бронировать на другие дни.
  const { data, error } = await supabase
    .from("slots")
    .select("slot_date, slot_time")
    .eq("user_id", userId)
    .eq("status", "busy")
    .order("slot_date", { ascending: true })
    .order("slot_time", { ascending: true });

  if (error) throw error;
  return data;
}

async function cancelBooking({ slotId, instructorId, userId, slotDate, slotTime, reason }) {
  // Освобождаем слот только если он всё ещё занят именно этим учеником —
  // простая защита от повторного/гоночного вызова отмены на один и тот же слот.
  const { data: updated, error: eUpdate } = await supabase
    .from("slots")
    .update({ status: "free", user_id: null })
    .eq("id", slotId)
    .eq("status", "busy")
    .eq("user_id", userId)
    .select();

  if (eUpdate) throw eUpdate;
  if (!updated || updated.length === 0) {
    return { ok: false, reason: "ALREADY_CANCELED" };
  }

  const { error: eHistory } = await supabase.from("history").insert({
    instructor_id: instructorId,
    user_id: userId,
    date: slotDate,
    time: slotTime,
    status: "canceled",
    cancel_reason: reason || null,
  });
  if (eHistory) throw eHistory;

  return { ok: true };
}

// --- Кусок 4: календарь и профиль ученика ---

async function getStudentHistory({ userId, monthStart, monthEnd }) {
  const { data, error } = await supabase
    .from("history")
    .select("date, time, status, cancel_reason")
    .eq("user_id", userId)
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .order("date", { ascending: true });

  if (error) throw error;
  return data;
}

async function updateUserProfile({ telegramId, name, phone, notificationEnabled }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (phone !== undefined) patch.phone = phone;
  if (notificationEnabled !== undefined) patch.notification_enabled = notificationEnabled;

  const { data, error } = await supabase
    .from("users")
    .update(patch)
    .eq("telegram_id", telegramId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// --- Кусок 4: база учеников и статистика инструктора ---

async function getAllStudents({ instructorId }) {
  const { data, error } = await supabase
    .from("users")
    .select("telegram_id, name, phone, notification_enabled")
    .eq("instructor_id", instructorId)
    .eq("is_admin", false)
    .order("name", { ascending: true });

  if (error) throw error;
  return data;
}

async function getStudentHistoryForInstructor({ instructorId, studentTelegramId }) {
  const { data, error } = await supabase
    .from("history")
    .select("id, date, time, status, cancel_reason")
    .eq("instructor_id", instructorId)
    .eq("user_id", studentTelegramId)
    .order("date", { ascending: false })
    .order("time", { ascending: false });

  if (error) throw error;
  return data;
}

async function getCompletedCountForMonth({ instructorId, monthStart, monthEnd }) {
  const { count, error } = await supabase
    .from("history")
    .select("id", { count: "exact", head: true })
    .eq("instructor_id", instructorId)
    .eq("status", "completed")
    .gte("date", monthStart)
    .lte("date", monthEnd);

  if (error) throw error;
  return count || 0;
}

async function markNoShow({ historyId, instructorId }) {
  // Обновляем, только если запись реально принадлежит этому инструктору и была 'completed' —
  // так нельзя случайно перезаписать чужую или уже отменённую запись.
  const { data, error } = await supabase
    .from("history")
    .update({ status: "no_show" })
    .eq("id", historyId)
    .eq("instructor_id", instructorId)
    .eq("status", "completed")
    .select()
    .maybeSingle();

  if (error) throw error;
  return data; // null, если подходящая запись не нашлась
}

// Атомарный перенос всех прошедших занятых слотов в history — одним SQL-запросом
// на стороне Postgres (см. sql/complete_past_slots_function.sql). Возвращает
// количество перенесённых занятий.
async function completePastSlots({ cutoffDate }) {
  const { data, error } = await supabase.rpc("complete_past_slots", { p_cutoff_date: cutoffDate });
  if (error) throw error;
  return data; // integer — сколько занятий перенесено
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
  saveMessageRelay,
  getRelayStudentId,
  getBookedSlotForStudent,
  getUpcomingBookingsForStudent,
  cancelBooking,
  getStudentHistory,
  updateUserProfile,
  getAllStudents,
  getStudentHistoryForInstructor,
  getCompletedCountForMonth,
  markNoShow,
  completePastSlots,
};
