function renderStudentView(root) {
  root.innerHTML = `
    <header class="app-header"><h1 id="dateLabelStudent">easy_drive</h1></header>
    <nav class="tabs">
      <button class="tab-btn active" data-tab="book">Запись</button>
      <button class="tab-btn" data-tab="schedule">Мои занятия</button>
      <button class="tab-btn" data-tab="profile">Профиль</button>
    </nav>

    <section id="tab-book" class="tab-panel active"></section>
    <section id="tab-schedule" class="tab-panel"></section>
    <section id="tab-profile" class="tab-panel"></section>
  `;

  const loaded = { book: false, schedule: false, profile: false };

  function activateTab(tabName) {
    root.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
    root.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tabName}`));

    if (!loaded[tabName]) {
      loaded[tabName] = true;
      const panel = root.querySelector(`#tab-${tabName}`);
      if (tabName === "book") renderBookingTab(panel);
      if (tabName === "schedule") renderScheduleTab(panel);
      if (tabName === "profile") renderProfileTab(panel);
    }
  }

  root.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  activateTab("book");
}

// Вкладка "Запись" — прежний экран бронирования свободных слотов на завтра
function renderBookingTab(panel) {
  panel.innerHTML = `
    <p class="hint">Выбери время — можно 1 час или 2 часа подряд</p>
    <div id="slotsGrid" class="hours-grid"></div>
    <button id="bookBtn" class="primary-btn">Записаться</button>
    <p id="bookStatus" class="status-text"></p>
  `;

  const selected = []; // сохраняем порядок выбора, максимум 2

  function isConsecutivePair(a, b, allTimes) {
    const ia = allTimes.indexOf(a);
    const ib = allTimes.indexOf(b);
    return Math.abs(ia - ib) === 1;
  }

  async function load() {
    const grid = panel.querySelector("#slotsGrid");
    grid.innerHTML = "<p class='hint'>Загрузка...</p>";
    try {
      const { slots } = await apiFetch("/student/slots");

      if (slots.length === 0) {
        grid.innerHTML = "<p class='hint'>Инструктор ещё не открыл запись на завтра</p>";
        return;
      }

      const allTimes = slots.map((s) => s.slot_time.slice(0, 5));
      grid.innerHTML = "";
      grid.style.display = "grid";

      slots.forEach((slot) => {
        const time = slot.slot_time.slice(0, 5);
        const isFree = slot.status === "free";
        const chip = document.createElement("button");
        chip.className = `slot-chip ${isFree ? "" : "busy"}`;
        chip.textContent = time;
        chip.disabled = !isFree;

        chip.addEventListener("click", () => {
          const alreadySelected = selected.includes(time);

          if (alreadySelected) {
            selected.splice(selected.indexOf(time), 1);
            chip.classList.remove("selected");
            return;
          }

          if (selected.length === 0) {
            selected.push(time);
            chip.classList.add("selected");
            return;
          }

          if (selected.length === 1) {
            if (!isConsecutivePair(selected[0], time, allTimes)) {
              panel.querySelector("#bookStatus").textContent =
                "Второй час должен идти подряд с первым (например, следующий час)";
              return;
            }
            selected.push(time);
            chip.classList.add("selected");
            return;
          }

          panel.querySelector("#bookStatus").textContent =
            "Можно выбрать максимум 2 часа подряд — сними один, чтобы выбрать другой";
        });

        grid.appendChild(chip);
      });
    } catch (err) {
      grid.innerHTML = `<p class='hint error-text'>Ошибка: ${err.message}</p>`;
    }
  }

  panel.querySelector("#bookBtn").addEventListener("click", async () => {
    const statusEl = panel.querySelector("#bookStatus");
    if (selected.length === 0) {
      statusEl.textContent = "Выбери хотя бы один час";
      return;
    }
    const btn = panel.querySelector("#bookBtn");
    btn.disabled = true;
    statusEl.textContent = "Записываем...";
    try {
      const result = await apiFetch("/student/book", {
        method: "POST",
        body: JSON.stringify({ times: [...selected] }),
      });
      statusEl.textContent = `Готово! Ты записан на ${result.booked.join(" и ")}. Подтверждение придёт в чат.`;
      tg.HapticFeedback.notificationOccurred("success");
      selected.length = 0;
      load();
    } catch (err) {
      statusEl.textContent = `Ошибка: ${err.message}`;
      tg.HapticFeedback.notificationOccurred("error");
    } finally {
      btn.disabled = false;
    }
  });

  load();
}
