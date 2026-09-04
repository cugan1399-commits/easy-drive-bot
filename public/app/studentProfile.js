function renderProfileTab(panel) {
  panel.innerHTML = `<p class="hint">Загрузка...</p>`;

  apiFetch("/student/profile")
    .then((profile) => {
      panel.innerHTML = `
        <div class="profile-field">
          <label for="profileName">Имя и фамилия</label>
          <input type="text" id="profileName" value="${profile.name || ""}" />
        </div>
        <div class="profile-field">
          <label for="profilePhone">Телефон</label>
          <input type="tel" id="profilePhone" value="${profile.phone || ""}" />
        </div>
        <div class="toggle-row">
          <span>Уведомления о расписании</span>
          <label class="switch">
            <input type="checkbox" id="profileNotif" ${profile.notificationEnabled ? "checked" : ""} />
            <span class="switch-track"></span>
          </label>
        </div>
        <button id="profileSaveBtn" class="primary-btn">Сохранить</button>
        <p id="profileStatus" class="status-text"></p>
      `;

      panel.querySelector("#profileSaveBtn").addEventListener("click", async () => {
        const statusEl = panel.querySelector("#profileStatus");
        const btn = panel.querySelector("#profileSaveBtn");
        const name = panel.querySelector("#profileName").value.trim();
        const phone = panel.querySelector("#profilePhone").value.trim();
        const notificationEnabled = panel.querySelector("#profileNotif").checked;

        if (!name || !phone) {
          statusEl.textContent = "Имя и телефон не могут быть пустыми";
          return;
        }

        btn.disabled = true;
        statusEl.textContent = "Сохраняем...";
        try {
          await apiFetch("/student/profile", {
            method: "PATCH",
            body: JSON.stringify({ name, phone, notificationEnabled }),
          });
          statusEl.textContent = "Сохранено ✅";
          tg.HapticFeedback.notificationOccurred("success");
        } catch (err) {
          statusEl.textContent = `Ошибка: ${err.message}`;
          tg.HapticFeedback.notificationOccurred("error");
        } finally {
          btn.disabled = false;
        }
      });
    })
    .catch((err) => {
      panel.innerHTML = `<p class="hint error-text">Ошибка: ${err.message}</p>`;
    });
}
