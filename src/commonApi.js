const express = require("express");
const { verifyInitData } = require("./telegramAuth");
const { getUserByTelegramId } = require("./db");

function requireRegisteredUser(botToken) {
  return async (req, res, next) => {
    const initData = req.headers["x-telegram-init-data"];
    const result = verifyInitData(initData, botToken);

    if (!result.ok || !result.user) {
      return res.status(401).json({ error: "Не удалось подтвердить пользователя Telegram" });
    }

    const dbUser = await getUserByTelegramId(result.user.id);
    if (!dbUser) {
      return res.status(403).json({ error: "Сначала напиши /start боту, чтобы заполнить профиль" });
    }

    req.telegramId = result.user.id;
    req.dbUser = dbUser;
    next();
  };
}

function createCommonRouter({ botToken }) {
  const router = express.Router();
  router.use(requireRegisteredUser(botToken));

  router.get("/me", (req, res) => {
    res.json({
      telegramId: req.dbUser.telegram_id,
      name: req.dbUser.name,
      isAdmin: req.dbUser.is_admin,
      instructorId: req.dbUser.instructor_id,
    });
  });

  return router;
}

module.exports = { createCommonRouter, requireRegisteredUser };
