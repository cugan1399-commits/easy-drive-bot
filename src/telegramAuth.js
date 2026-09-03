const crypto = require("crypto");

/**
 * Проверяет подлинность initData, которую Telegram Mini App присылает на бэкенд.
 * Без этой проверки любой человек мог бы дёргать /api/admin/* напрямую через curl,
 * подставив чужой telegram_id.
 *
 * Возвращает { ok: true, user } либо { ok: false }.
 */
function verifyInitData(initData, botToken) {
  if (!initData || typeof initData !== "string") return { ok: false };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) return { ok: false };

  const userRaw = params.get("user");
  const user = userRaw ? JSON.parse(userRaw) : null;
  return { ok: true, user };
}

module.exports = { verifyInitData };
