function renderStudentsTab(panel) {
  panel.innerHTML = `
    <div class="stats-card">
      <div>
        <div class="stats-number" id="statsNumber">—</div>
        <div class="stats-label">занятий проведено</div>
      </div>
      <select id="statsMonth"></select>
    </div>

    <div id="studentsList"></div>

    <div class="broadcast-box">
      <p class="hint">Массовая рассылка своим ученикам (акции, свободные окна и т.п.)</p>
      <textarea id="broadcastText" rows="3" placeholder="Текст сообщения..."></textarea>
      <button id="broadcastBtn" class="primary-btn">Отправить всем</button>
      <p id="broadcastStatus" class="status-text"></p>
    </div>
  `;

  populateMonthSelect(panel);
  loadStats(panel);
  loadStudents(panel);

  panel.querySelector("#statsMonth").addEventListener("change", () => loadStats(panel));

  panel.querySelector("#broadcastBtn").addEventListener("click", async () => {
    const textarea = panel.querySelector("#broadcastText");
    const statusEl = panel.querySelector("#broadcastStatus");
    const btn = panel.querySelector("#broadcastBtn");
    const text = textarea.value.trim();
    if (!text) {
      statusEl.textContent = "Введи текст рассылки";
      return;
    }

    btn.disabled = true;
    statusEl.textContent = "Отправляем...";
    try {
      const result = await apiFetch("/admin/broadcast", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      statusEl.textContent = `Отправлено ${result.notified} из ${result.total} учеников`;
      tg.HapticFeedback.notificationOccurred("success");
      textarea.value = "";
    } catch (err) {
      statusEl.textContent = `Ошибка: ${err.message}`;
      tg.HapticFeedback.notificationOccurred("error");
    } finally {
      btn.disabled = false;
    }
  });
}

function populateMonthSelect(panel) {
  const select = panel.querySelector("#statsMonth");
  const now = new Date();
  const monthNames = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];

  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    select.appendChild(option);
  }
}

async function loadStats(panel) {
  const numberEl = panel.querySelector("#statsNumber");
  numberEl.textContent = "…";
  try {
    const month = panel.querySelector("#statsMonth").value;
    const { completedCount } = await apiFetch(`/admin/stats?month=${month}`);
    numberEl.textContent = completedCount;
  } catch (err) {
    numberEl.textContent = "—";
  }
}

async function loadStudents(panel) {
  const list = panel.querySelector("#studentsList");
  list.innerHTML = "<p class='hint'>Загрузка...</p>";
  try {
    const { students } = await apiFetch("/admin/students");
    if (students.length === 0) {
      list.innerHTML = "<p class='hint'>Пока нет ни одного ученика</p>";
      return;
    }

    list.innerHTML = "";
    students.forEach((student) => {
      const item = document.createElement("div");
      item.className = "student-list-item";
      item.innerHTML = `
        <div>
          <div class="student-name">${student.name}</div>
          <div class="student-phone">${student.phone || ""}</div>
        </div>
        <span class="hint">История ›</span>
      `;
      item.addEventListener("click", () => openStudentCard(student));
      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = `<p class='hint error-text'>Ошибка: ${err.message}</p>`;
  }
}

function statusLabel(status) {
  if (status === "completed") return "Проведено";
  if (status === "canceled") return "Отменено";
  if (status === "no_show") return "Не пришёл(а)";
  return status;
}

async function openStudentCard(student) {
  document.querySelector(".modal-backdrop")?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" style="max-height: 70vh; overflow-y: auto;">
      <h3>${student.name}</h3>
      <p class="hint">${student.phone || ""}</p>
      <div id="studentHistoryList"><p class="hint">Загрузка истории...</p></div>
      <div class="msg-sheet-buttons" style="margin-top: 14px;">
        <button class="secondary-btn" id="studentCardClose">Закрыть</button>
        <button class="primary-btn" id="studentCardMsg">💬 Написать</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector("#studentCardClose").addEventListener("click", close);
  backdrop.querySelector("#studentCardMsg").addEventListener("click", () => {
    close();
    openMessageSheet(student.telegram_id, student.name);
  });

  try {
    const { history } = await apiFetch(`/admin/students/${student.telegram_id}/history`);
    const historyEl = backdrop.querySelector("#studentHistoryList");

    if (history.length === 0) {
      historyEl.innerHTML = "<p class='hint'>Занятий ещё не было</p>";
      return;
    }

    historyEl.innerHTML = history
      .map(
        (h) => `
          <div class="lesson-row">
            <span>${h.date} ${h.time.slice(0, 5)}</span>
            <span class="lesson-status ${h.status}">${statusLabel(h.status)}</span>
            ${
              h.status === "completed"
                ? `<button class="cancel-btn" data-history-id="${h.id}">Не было</button>`
                : ""
            }
          </div>
          ${h.status === "canceled" && h.cancel_reason ? `<p class="hint" style="margin:2px 0 8px;">Причина: ${h.cancel_reason}</p>` : ""}
        `
      )
      .join("");

    historyEl.querySelectorAll("[data-history-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await apiFetch(`/admin/history/${btn.dataset.historyId}/no-show`, { method: "POST" });
          btn.closest(".lesson-row").querySelector(".lesson-status").textContent = statusLabel("no_show");
          btn.closest(".lesson-row").querySelector(".lesson-status").className = "lesson-status no_show";
          btn.remove();
        } catch (err) {
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    backdrop.querySelector("#studentHistoryList").innerHTML =
      `<p class="hint error-text">Ошибка: ${err.message}</p>`;
  }
}
