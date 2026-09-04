(async function bootstrap() {
  const root = document.getElementById("app");

  try {
    const me = await apiFetch("/me");
    if (me.isAdmin) {
      renderInstructorView(root);
    } else {
      renderStudentView(root);
    }
  } catch (err) {
    root.innerHTML = `<div class="loading-screen error-text">Не получилось загрузить профиль: ${err.message}</div>`;
  }
})();
