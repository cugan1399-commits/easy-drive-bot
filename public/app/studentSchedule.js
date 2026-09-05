const CALENDAR_MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const CALENDAR_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function renderScheduleTab(panel) {
  panel.innerHTML = `
    <div class="calendar-header">
      <button class="nav-btn" id="calPrev">‹</button>
      <span class="month-label" id="calMonthLabel"></span>
      <button class="nav-btn" id="calNext">›</button>
    </div>
    <div class="calendar-grid" id="calGrid"></div>
    <div id="dayDetail"></div>
  `;

  const today = new Date();
  const state = {
    year: today.getFullYear(),
    month: today.getMonth(), // 0-based
    upcoming: [], // [{date, time}] — активные брони ученика (для кнопки отмены)
  };

  function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
  }

  async function loadMonth() {
    panel.querySelector("#calMonthLabel").textContent = `${CALENDAR_MONTH_NAMES[state.month]} ${state.year}`;
    const grid = panel.querySelector("#calGrid");
    grid.innerHTML = "<p class='hint'>Загрузка...</p>";
    panel.querySelector("#dayDetail").innerHTML = "";

    try {
      const [{ history }, { upcoming }] = await Promise.all([
        apiFetch(`/student/history?month=${monthKey(state.year, state.month)}`),
        apiFetch("/student/upcoming"),
      ]);
      state.upcoming = upcoming;
      renderGrid(grid, history);
    } catch (err) {
      grid.innerHTML = `<p class='hint error-text'>Ошибка: ${err.message}</p>`;
    }
  }

  function renderGrid(grid, history) {
    const byDate = {};
    history.forEach((h) => {
      if (!byDate[h.date]) byDate[h.date] = [];
      byDate[h.date].push(h);
    });
    state.upcoming.forEach((u) => {
      if (!byDate[u.date]) byDate[u.date] = [];
      byDate[u.date].push({ date: u.date, time: u.time, status: "busy" });
    });

    grid.innerHTML = "";
    CALENDAR_WEEKDAYS.forEach((wd) => {
      const el = document.createElement("div");
      el.className = "calendar-weekday";
      el.textContent = wd;
      grid.appendChild(el);
    });

    const firstOfMonth = new Date(state.year, state.month, 1);
    // Понедельник = 0 ... Воскресенье = 6, чтобы неделя начиналась с Пн
    const leadingEmpty = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();

    for (let i = 0; i < leadingEmpty; i++) {
      const empty = document.createElement("div");
      empty.className = "calendar-day empty";
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${state.year}-${String(state.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cell = document.createElement("button");
      cell.className = "calendar-day";
      cell.textContent = day;

      const entries = byDate[dateStr];
      if (entries && entries.length > 0) {
        const hasCompleted = entries.some((e) => e.status === "completed" || e.status === "busy");
        const hasCanceled = entries.some((e) => e.status === "canceled");
        if (hasCompleted) {
          const dot = document.createElement("span");
          dot.className = "dot completed";
          cell.appendChild(dot);
        } else if (hasCanceled) {
          const dot = document.createElement("span");
          dot.className = "dot canceled";
          cell.appendChild(dot);
        }
      }

      cell.addEventListener("click", () => renderDayDetail(dateStr, entries || []));
      grid.appendChild(cell);
    }
  }

  function statusLabel(status) {
    if (status === "completed") return "Проведено";
    if (status === "canceled") return "Отменено";
    if (status === "busy") return "Забронировано";
    return status;
  }

  function isCancelable(dateStr, time) {
    // +03:00 — явно фиксируем московское время занятия, а не полагаемся на часовой
    // пояс браузера ученика (тот же принцип, что и на бэкенде, см. dateUtils.js)
    const lessonStart = new Date(`${dateStr}T${time}:00+03:00`);
    const hoursLeft = (lessonStart.getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursLeft >= 2; // держим в паре с CANCEL_MIN_HOURS_BEFORE на бэкенде
  }

  function renderDayDetail(dateStr, entries) {
    const detail = panel.querySelector("#dayDetail");
    if (entries.length === 0) {
      detail.innerHTML = `<p class="hint">${dateStr}: занятий нет</p>`;
      return;
    }

    detail.innerHTML = `
      <div class="day-detail-card">
        <p class="hint" style="margin-bottom:8px;">${dateStr}</p>
        ${entries
          .map((e, i) => {
            const canCancel = e.status === "busy" && isCancelable(dateStr, e.time);
            return `
              <div class="lesson-row">
                <span>${e.time}</span>
                <span class="lesson-status ${e.status}">${statusLabel(e.status)}</span>
                ${
                  e.status === "busy"
                    ? `<button class="cancel-btn" data-i="${i}" ${canCancel ? "" : "disabled"}>❌ Отменить</button>`
                    : ""
                }
              </div>
              ${e.status === "canceled" && e.cancel_reason ? `<p class="hint" style="margin:2px 0 8px;">Причина: ${e.cancel_reason}</p>` : ""}
            `;
          })
          .join("")}
      </div>
    `;

    detail.querySelectorAll(".cancel-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entry = entries[Number(btn.dataset.i)];
        openCancelModal(dateStr, entry.time, () => loadMonth());
      });
    });
  }

  function openCancelModal(dateStr, time, onDone) {
    document.querySelector(".modal-backdrop")?.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal-card">
        <h3>Нам очень жаль! 😔</h3>
        <p class="hint">Напишите причину отмены (необязательно)</p>
        <textarea id="cancelReason" rows="3" placeholder="Причина..."></textarea>
        <div class="msg-sheet-buttons">
          <button class="secondary-btn" id="cancelModalClose">Назад</button>
          <button class="primary-btn" id="cancelModalOk">ОК</button>
        </div>
        <p class="status-text" id="cancelModalStatus"></p>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    backdrop.querySelector("#cancelModalClose").addEventListener("click", close);

    backdrop.querySelector("#cancelModalOk").addEventListener("click", async () => {
      const reason = backdrop.querySelector("#cancelReason").value.trim();
      const statusEl = backdrop.querySelector("#cancelModalStatus");
      const okBtn = backdrop.querySelector("#cancelModalOk");
      okBtn.disabled = true;
      statusEl.textContent = "Отменяем...";
      try {
        await apiFetch("/student/cancel", {
          method: "POST",
          body: JSON.stringify({ slotDate: dateStr, slotTime: time, reason }),
        });
        statusEl.textContent = "Занятие отменено";
        tg.HapticFeedback.notificationOccurred("success");
        setTimeout(() => {
          close();
          onDone();
        }, 700);
      } catch (err) {
        statusEl.textContent = `Ошибка: ${err.message}`;
        okBtn.disabled = false;
      }
    });
  }

  panel.querySelector("#calPrev").addEventListener("click", () => {
    state.month -= 1;
    if (state.month < 0) {
      state.month = 11;
      state.year -= 1;
    }
    loadMonth();
  });

  panel.querySelector("#calNext").addEventListener("click", () => {
    state.month += 1;
    if (state.month > 11) {
      state.month = 0;
      state.year += 1;
    }
    loadMonth();
  });

  loadMonth();
}
