const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const initData = tg.initData;

function apiFetch(path, options = {}) {
  return fetch(`/api${path}`, {
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
