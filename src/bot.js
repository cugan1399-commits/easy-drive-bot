const { Bot, session } = require("grammy");
const { conversations, createConversation } = require("@grammyjs/conversations");
const { getUserByTelegramId, createUser } = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const INSTRUCTOR_TELEGRAM_ID = Number(process.env.INSTRUCTOR_TELEGRAM_ID);

if (!BOT_TOKEN) throw new Error("BOT_TOKEN не задан в .env");
if (!INSTRUCTOR_TELEGRAM_ID) {
  throw new Error("INSTRUCTOR_TELEGRAM_ID не задан в .env — впиши свой личный telegram_id");
}

const bot = new Bot(BOT_TOKEN);

bot.use(session({ initial: () => ({}) }));
bot.use(conversations());

// Разговор для заполнения профиля нового ученика: имя -> телефон -> запись в БД
async function fillProfile(conversation, ctx) {
  await ctx.reply("Привет! Похоже, ты здесь впервые 🚗\nКак тебя зовут? (Имя и Фамилия)");
  const nameCtx = await conversation.waitFor("message:text");
  const name = nameCtx.message.text.trim();

  await ctx.reply(
    "Отлично! Теперь оставь номер телефона для связи (просто напиши текстом, например +375291234567):"
  );
  const phoneCtx = await conversation.waitFor("message:text");
  const phone = phoneCtx.message.text.trim();

  const telegramId = ctx.from.id;
  const isAdmin = telegramId === INSTRUCTOR_TELEGRAM_ID;

  await conversation.external(() =>
    createUser({
      telegramId,
      name,
      phone,
      instructorId: INSTRUCTOR_TELEGRAM_ID,
      isAdmin,
    })
  );

  await ctx.reply(
    isAdmin
      ? `Готово, ${name}! Профиль инструктора создан. Напиши /app, чтобы опубликовать расписание.`
      : `Спасибо, ${name}! Профиль заполнен. Как только инструктор откроет запись на завтра — пришлём уведомление, а записаться сможешь через /app.`
  );
}

bot.use(createConversation(fillProfile));

bot.command("start", async (ctx) => {
  const telegramId = ctx.from.id;
  const existingUser = await getUserByTelegramId(telegramId);

  if (existingUser) {
    await ctx.reply(`С возвращением, ${existingUser.name}! 👋`);
    return;
  }

  await ctx.conversation.enter("fillProfile");
});

// Экологичная отписка от уведомлений о расписании
bot.command("stop_notif", async (ctx) => {
  const { supabase } = require("./db");
  const { error } = await supabase
    .from("users")
    .update({ notification_enabled: false })
    .eq("telegram_id", ctx.from.id);

  if (error) {
    await ctx.reply("Не получилось отключить уведомления, попробуй позже.");
    return;
  }
  await ctx.reply("Уведомления о расписании отключены. Включить обратно — напиши /start_notif.");
});

bot.command("start_notif", async (ctx) => {
  const { supabase } = require("./db");
  const { error } = await supabase
    .from("users")
    .update({ notification_enabled: true })
    .eq("telegram_id", ctx.from.id);

  if (error) {
    await ctx.reply("Не получилось включить уведомления, попробуй позже.");
    return;
  }
  await ctx.reply("Уведомления о расписании снова включены ✅");
});

// Открывает Mini App — доступно всем зарегистрированным пользователям,
// сама Mini App решает, какой экран показать (инструктор/ученик)
bot.command("app", async (ctx) => {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    await ctx.reply("APP_URL не задан в .env — без него не могу открыть Mini App.");
    return;
  }

  await ctx.reply("Открываю приложение:", {
    reply_markup: {
      inline_keyboard: [[{ text: "🚗 Открыть", web_app: { url: `${appUrl}/app/` } }]],
    },
  });
});

// Открывает Mini App — доступно только инструктору
bot.command("admin", async (ctx) => {
  if (ctx.from.id !== INSTRUCTOR_TELEGRAM_ID) {
    await ctx.reply("Эта команда доступна только инструктору.");
    return;
  }

  const appUrl = process.env.APP_URL; // например, https://auto-school-bot.onrender.com
  if (!appUrl) {
    await ctx.reply("APP_URL не задан в .env — без него не могу открыть Mini App.");
    return;
  }

  await ctx.reply("Открой панель управления расписанием:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📅 Открыть панель", web_app: { url: `${appUrl}/admin/` } }],
      ],
    },
  });
});

bot.catch((botError) => {
  // grammy оборачивает реальную ошибку в BotError — сам err.message часто бесполезен
  // ("Error while handling update ..."), настоящая причина лежит в botError.error
  const ctx = botError.ctx;
  const realError = botError.error;

  console.error("--- Ошибка в обработчике апдейта ---");
  console.error("update_id:", ctx?.update?.update_id);
  console.error("from telegram_id:", ctx?.from?.id);
  console.error("текст сообщения:", ctx?.message?.text);
  console.error("реальная ошибка:", realError);

  // Если это ошибка Supabase/Postgres — у неё обычно есть эти поля
  if (realError && (realError.code || realError.details || realError.hint)) {
    console.error("Postgres code:", realError.code);
    console.error("Postgres details:", realError.details);
    console.error("Postgres hint:", realError.hint);
  }
  console.error("-------------------------------------");
});

module.exports = bot;
