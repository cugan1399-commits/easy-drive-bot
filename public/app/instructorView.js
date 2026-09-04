function renderInstructorView(root) {
  root.innerHTML = `
    <header class="app-header"><h1 id="dateLabel">Расписание на завтра</h1></header>
    <nav class="tabs">
      <button class="tab-btn active" data-tab="publish">Включить запись</button>
      <button class="tab-btn" data-tab="day">Мой день</button>
    </nav>
    <section id="tab-publish" class="tab-panel active">
      <p class="hint">Выбери часы, когда готов принимать учеников завтра</p>
      <div id="hoursGrid" class="hours-grid"></div>
      <button id="publishBtn" class="primary-btn">Опубликовать на завтра</button>
      <p id="publishStatus" class="status-text"></p>
    </section>
    <section id="tab-day" class="tab-panel">
      <p class="hint">Кто записан на выбранный день</p>
      <div id="dayList" class="day-list"></div>
    </section>
  `;

  root.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      root.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      root.querySelector(`#tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "day") loadDay(root);
    });
  });

  const selectedHours = new Set();

  apiFetch("/admin/hours").then(({ hours }) => {
    const grid = root.querySelector("#hoursGrid");
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
  });

  root.querySelector("#publishBtn").addEventListener("click", async () => {
    const statusEl = root.querySelector("#publishStatus");
    if (selectedHours.size === 0) {
      statusEl.textContent = "Выбери хотя бы один час";
      return;
    }
    const btn = root.querySelector("#publishBtn");
    btn.disabled = true;
    statusEl.textContent = "Публикуем и рассылаем...";
    try {
      const result = await apiFetch("/admin/publish", {
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
}

async function loadDay(root) {
  const list = root.querySelector("#dayList");
  list.innerHTML = "<p class='hint'>Загрузка...</p>";
  try {
    const { slots, slotDate } = await apiFetch("/admin/day");
    root.querySelector("#dateLabel").textContent = `Расписание на ${slotDate}`;
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
              ? `<a href="tel:${student.phone}">📞</a><a href="https://t.me/${slot.user_id}">💬</a>`
              : ""
          }
        </span>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = `<p class='hint error-text'>Ошибка: ${err.message}</p>`;
  }
}
