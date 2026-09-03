const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const initData = tg.initData; // подписанная строка от Telegram, шлём как есть на бэкенд

function apiFetch(path, options = {}) {
  return fetch(`/api/admin${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
      ...(options.headers || {}),
    },
  }).then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Ошибка запроса");
    return body;
  });
}

// --- Табы ---
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

    if (btn.dataset.tab === "day") loadDay();
  });
});

// --- Вкладка "Включить запись" ---
const selectedHours = new Set();

async function renderHoursGrid() {
  const { hours } = await apiFetch("/hours");
  const grid = document.getElementById("hoursGrid");
  grid.innerHTML = "";
  hours.forEach((hour) => {
    const chip = document.createElement("button");
    chip.className = "hour-chip";
    chip.textContent = hour;
    chip.addEventListener("click", () => {
      if (selectedHours.has(hour)) {
        selectedHours.delete(hour);
        chip.classList.remove("selected");
      } else {
        selectedHours.add(hour);
        chip.classList.add("selected");
      }
    });
    grid.appendChild(chip);
  });
}

document.getElementById("publishBtn").addEventListener("click", async () => {
  const statusEl = document.getElementById("publishStatus");
  if (selectedHours.size === 0) {
    statusEl.textContent = "Выбери хотя бы один час";
    return;
  }

  const btn = document.getElementById("publishBtn");
  btn.disabled = true;
  statusEl.textContent = "Публикуем и рассылаем...";

  try {
    const result = await apiFetch("/publish", {
      method: "POST",
      body: JSON.stringify({ times: [...selectedHours] }),
    });
    statusEl.textContent = `Готово! Опубликовано часов: ${result.publishedHours.length}. Уведомлено учеников: ${result.notified}.`;
    tg.HapticFeedback.notificationOccurred("success");
  } catch (err) {
    statusEl.textContent = `Ошибка: ${err.message}`;
    tg.HapticFeedback.notificationOccurred("error");
  } finally {
    btn.disabled = false;
  }
});

// --- Вкладка "Мой день" ---
async function loadDay() {
  const list = document.getElementById("dayList");
  list.innerHTML = "<p class='hint'>Загрузка...</p>";

  try {
    const { slots, slotDate } = await apiFetch("/day");
    document.getElementById("dateLabel").textContent = `Расписание на ${slotDate}`;

    if (slots.length === 0) {
      list.innerHTML = "<p class='hint'>На этот день пока ничего не опубликовано</p>";
      return;
    }

    list.innerHTML = "";
    slots.forEach((slot) => {
      const row = document.createElement("div");
      const isFree = slot.status === "free";
      row.className = `day-row ${isFree ? "free" : ""}`;

      const student = slot.users;
      row.innerHTML = `
        <span class="time">${slot.slot_time.slice(0, 5)}</span>
        <span class="student">${isFree ? "Свободно" : student?.name || "—"}</span>
        <span class="actions">
          ${
            !isFree && student?.phone
              ? `<a href="tel:${student.phone}">📞</a>
                 <a href="https://t.me/${slot.user_id}">💬</a>`
              : ""
          }
        </span>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<p class='hint'>Ошибка: ${err.message}</p>`;
  }
}

renderHoursGrid();
