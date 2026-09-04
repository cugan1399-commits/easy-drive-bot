function renderInstructorView(root) {
  root.innerHTML = `
    <header class="app-header"><h1 id="dateLabel">Расписание</h1></header>
    <nav class="tabs">
      <button class="tab-btn active" data-tab="publish">Включить запись</button>
      <button class="tab-btn" data-tab="day">Мой день</button>
    </nav>

    <section id="tab-publish" class="tab-panel active">
      <div id="dateChips" class="hours-grid" style="grid-template-columns: repeat(3, 1fr);"></div>
      <div id="publishBody"></div>
    </section>

    <section id="tab-day" class="tab-panel">
      <div id="dayDateChips" class="hours-grid" style="grid-template-columns: repeat(3, 1fr);"></div>
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
      if (btn.dataset.tab === "day") initDayDateChips();
    });
  });

  const state = { selectedDate: null, mode: "loading" }; // mode: 'locked' | 'editing'

  function formatDateLabel(dateStr, todayStr, tomorrowStr) {
    if (dateStr === todayStr) return "Сегодня";
    if (dateStr === tomorrowStr) return "Завтра";
    const [, m, d] = dateStr.split("-");
    return `${d}.${m}`;
  }

  async function initDayDateChips() {
    const { dates } = await apiFetch("/admin/quick-dates");
    const [todayStr, tomorrowStr] = dates;
    const chips = root.querySelector("#dayDateChips");
    if (chips.dataset.built) {
      // уже построено — просто перезагрузим текущую дату
      loadDay(root, chips.querySelector(".selected")?.dataset.date || dates[1]);
      return;
    }
    chips.dataset.built = "1";
    chips.innerHTML = "";
    dates.forEach((dateStr, i) => {
      const chip = document.createElement("button");
      chip.className = "hour-chip";
      chip.textContent = formatDateLabel(dateStr, todayStr, tomorrowStr);
      chip.dataset.date = dateStr;
      chip.addEventListener("click", () => {
        [...chips.children].forEach((c) => c.classList.toggle("selected", c === chip));
        loadDay(root, dateStr);
      });
      chips.appendChild(chip);
      if (i === 1) chip.classList.add("selected");
    });
    loadDay(root, dates[1]);
  }

  async function initDateChips() {
    const { dates } = await apiFetch("/admin/quick-dates");
    const [todayStr, tomorrowStr] = dates;
    const chips = root.querySelector("#dateChips");
    chips.innerHTML = "";
    dates.forEach((dateStr, i) => {
      const chip = document.createElement("button");
      chip.className = "hour-chip";
      chip.textContent = formatDateLabel(dateStr, todayStr, tomorrowStr);
      chip.dataset.date = dateStr;
      chip.addEventListener("click", () => selectDate(dateStr, chips));
      chips.appendChild(chip);
      if (i === 1) chip.classList.add("selected"); // по умолчанию "Завтра"
    });
    selectDate(dates[1], chips); // по умолчанию открываем "Завтра"
  }

  async function selectDate(dateStr, chipsContainer) {
    state.selectedDate = dateStr;
    [...chipsContainer.children].forEach((c) => {
      c.classList.toggle("selected", c.dataset.date === dateStr);
    });
    await loadScheduleForDate(dateStr);
  }

  async function loadScheduleForDate(dateStr) {
    const body = root.querySelector("#publishBody");
    body.innerHTML = "<p class='hint'>Загрузка...</p>";
    root.querySelector("#dateLabel").textContent = `Расписание на ${dateStr}`;

    try {
      const { hours, isPublished } = await apiFetch(`/admin/schedule?date=${dateStr}`);
      if (isPublished) {
        renderLockedView(body, dateStr, hours);
      } else {
        renderEditingView(body, dateStr, hours, true);
      }
    } catch (err) {
      body.innerHTML = `<p class="hint error-text">Ошибка: ${err.message}</p>`;
    }
  }

  function renderLockedView(body, dateStr, hours) {
    const openHours = hours.filter((h) => h.status === "free" || h.status === "busy");
    body.innerHTML = `
      <p class="hint">Уже опубликовано на ${dateStr}:</p>
      <div class="hours-grid">
        ${openHours
          .map(
            (h) =>
              `<div class="hour-chip ${h.status === "busy" ? "selected" : ""}">${h.time}${h.status === "busy" ? " 🔒" : ""}</div>`
          )
          .join("")}
      </div>
      <button id="editBtn" class="primary-btn" style="margin-top:14px;">Внести корректировки</button>
    `;
    body.querySelector("#editBtn").addEventListener("click", () => {
      renderEditingView(body, dateStr, hours, false);
    });
  }

  function renderEditingView(body, dateStr, hours, isFreshDate) {
    const selected = new Set(hours.filter((h) => h.status === "free").map((h) => h.time));

    body.innerHTML = `
      <p class="hint">Выбери часы, когда готов принимать учеников</p>
      <div id="hoursGrid" class="hours-grid"></div>
      <button id="publishBtn" class="primary-btn">${isFreshDate ? `Опубликовать на ${dateStr}` : "Опубликовать новое"}</button>
      <p id="publishStatus" class="status-text"></p>
    `;

    const grid = body.querySelector("#hoursGrid");
    hours.forEach((h) => {
      const chip = document.createElement("button");
      chip.className = "hour-chip";
      chip.textContent = h.time;

      if (h.status === "busy") {
        chip.classList.add("selected");
        chip.disabled = true;
        chip.title = "Уже забронировано учеником — нельзя снять";
        chip.style.opacity = "0.6";
      } else {
        if (selected.has(h.time)) chip.classList.add("selected");
        chip.addEventListener("click", () => {
          if (selected.has(h.time)) {
            selected.delete(h.time);
            chip.classList.remove("selected");
          } else {
            selected.add(h.time);
            chip.classList.add("selected");
          }
        });
      }
      grid.appendChild(chip);
    });

    body.querySelector("#publishBtn").addEventListener("click", async () => {
      const statusEl = body.querySelector("#publishStatus");
      const btn = body.querySelector("#publishBtn");
      btn.disabled = true;
      statusEl.textContent = "Публикуем...";
      try {
        const result = await apiFetch("/admin/publish", {
          method: "POST",
          body: JSON.stringify({ date: dateStr, times: [...selected] }),
        });
        statusEl.textContent = `Готово! Добавлено часов: ${result.added.length}, убрано: ${result.removed.length}. Уведомлено: ${result.notified}.`;
        tg.HapticFeedback.notificationOccurred("success");
        setTimeout(() => loadScheduleForDate(dateStr), 900);
      } catch (err) {
        statusEl.textContent = `Ошибка: ${err.message}`;
        tg.HapticFeedback.notificationOccurred("error");
        btn.disabled = false;
      }
    });
  }

  initDateChips();
}

async function loadDay(root, dateStr) {
  const list = root.querySelector("#dayList");
  list.innerHTML = "<p class='hint'>Загрузка...</p>";
  try {
    const { slots, slotDate } = await apiFetch(`/admin/day${dateStr ? `?date=${dateStr}` : ""}`);
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
              ? `<a href="tel:${student.phone}">📞</a><button class="msg-btn" data-uid="${slot.user_id}">💬</button>`
              : ""
          }
        </span>
      `;
      list.appendChild(row);

      if (!isFree) {
        const msgBtn = row.querySelector(".msg-btn");
        msgBtn?.addEventListener("click", () => toggleMessageForm(row, slot.user_id));
      }
    });
  } catch (err) {
    list.innerHTML = `<p class='hint error-text'>Ошибка: ${err.message}</p>`;
  }
}

function toggleMessageForm(row, studentTelegramId) {
  const existing = row.querySelector(".msg-form");
  if (existing) {
    existing.remove();
    return;
  }
  const form = document.createElement("div");
  form.className = "msg-form";
  form.style.cssText = "margin-top:8px; display:flex; gap:6px;";
  form.innerHTML = `
    <input type="text" placeholder="Текст сообщения..." style="flex:1; padding:8px; border-radius:8px; border:1px solid #2C2C2E; background:#121212; color:#fff;" />
    <button class="primary-btn" style="width:auto; padding:8px 14px;">Отправить</button>
  `;
  row.appendChild(form);

  const input = form.querySelector("input");
  const sendBtn = form.querySelector("button");
  sendBtn.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    try {
      await apiFetch("/admin/message-student", {
        method: "POST",
        body: JSON.stringify({ studentTelegramId, text }),
      });
      form.innerHTML = "<span class='hint'>Отправлено ✅</span>";
      setTimeout(() => form.remove(), 1500);
    } catch (err) {
      form.innerHTML = `<span class="hint error-text">Ошибка: ${err.message}</span>`;
    }
  });
}
