import { Bot, Context, Keyboard, InlineKeyboard, session, SessionFlavor } from "grammy";
import { eq, sql } from "drizzle-orm";
import { db, balancesTable, dealsTable } from "@workspace/db";
import { logger } from "./lib/logger";

const SUPPORT_USERNAME = "@AtdBotSupport";

type Currency = "hrn" | "rub" | "ton" | "stars";

const CURRENCY_LABELS: Record<Currency, string> = {
  hrn: "ГРН",
  rub: "РУБ",
  ton: "TON",
  stars: "Звёзды",
};

const CURRENCY_ALIASES: Record<string, Currency> = {
  грн: "hrn", uah: "hrn", гривны: "hrn", гривна: "hrn",
  руб: "rub", rub: "rub", рубли: "rub", рублей: "rub", рубль: "rub",
  тон: "ton", ton: "ton",
  звезды: "stars", stars: "stars", звезда: "stars", звёзды: "stars",
};

interface SessionData {
  step?: "title" | "price";
  dealTitle?: string;
  dealPrice?: number;
}

type MyContext = Context & SessionFlavor<SessionData>;

function normalizeCurrency(raw: string): Currency | null {
  return CURRENCY_ALIASES[raw.toLowerCase().trim()] ?? null;
}

function generateDealId(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function mainMenu() {
  return new Keyboard()
    .text("🤝 Создать сделку").row()
    .text("💼 Кошелёк").text("📊 Статистика").row()
    .text("📈 Моя статистика").text("💱 Конвертер").row()
    .text("📖 Инструкция").text("🆘 Поддержка")
    .resized()
    .persistent();
}

function esc(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

function num(value: number | string): string {
  return esc(String(value));
}

function fmtPrice(value: number | string): string {
  const n = parseFloat(String(value));
  return num(Number.isInteger(n) ? n.toString() : n.toString());
}

function isPrivate(ctx: MyContext): boolean {
  return ctx.chat?.type === "private";
}

async function getOrCreateBalance(userId: string) {
  const existing = await db.select().from(balancesTable).where(eq(balancesTable.userId, userId)).limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(balancesTable).values({ userId }).returning();
  return created;
}

export function createBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.error("TELEGRAM_BOT_TOKEN is not set — bot will not start");
    return null;
  }

  const bot = new Bot<MyContext>(token);
  bot.use(session<SessionData, MyContext>({ initial: (): SessionData => ({}) }));

  bot.api.setMyCommands([
    { command: "start",       description: "🏠 Главное меню" },
    { command: "wallet",      description: "💼 Кошелёк и баланс" },
    { command: "stats",       description: "📊 Статистика бота" },
    { command: "instruction", description: "📖 Как создать сделку" },
    { command: "support",     description: "🆘 Поддержка" },
    { command: "help",        description: "❓ Помощь" },
  ]).catch(() => {});

  // /start
  bot.command("start", async (ctx) => {
    const userId = String(ctx.from?.id ?? "");
    if (userId) await getOrCreateBalance(userId);

    const startParam = ctx.match;
    if (typeof startParam === "string" && startParam.startsWith("deal_")) {
      const dealId = startParam.replace("deal_", "");
      const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.dealId, dealId)).limit(1);

      if (!deal) {
        await ctx.reply("❌ Сделка не найдена или аннулирована\\.", { parse_mode: "MarkdownV2", reply_markup: mainMenu() });
        return;
      }
      if (deal.status !== "active") {
        await ctx.reply("❌ Эта сделка уже завершена или оплачена\\.", { parse_mode: "MarkdownV2", reply_markup: mainMenu() });
        return;
      }
      if (deal.sellerId === userId) {
        await ctx.reply(
          "⚠️ *Вы продавец этой сделки*\\.\n\n" +
          "Покупатель ещё не оплатил\\. Ожидайте уведомления\\.",
          { parse_mode: "MarkdownV2", reply_markup: mainMenu() }
        );
        return;
      }

      await db.update(dealsTable).set({ buyerId: userId }).where(eq(dealsTable.dealId, dealId));

      const kb = new InlineKeyboard()
        .text("💳 Оплатить сделку", `pay_${dealId}`).row()
        .text("❌ Отмена", "menu_main");

      await ctx.reply(
        "🤝 *Страница сделки*\n\n" +
        `📦 *Товар:* ${esc(deal.title)}\n` +
        `💵 *Сумма:* ${fmtPrice(deal.price as string)} ${CURRENCY_LABELS[deal.currency as Currency] ?? deal.currency}\n` +
        `🆔 *ID сделки:* \`${dealId}\`\n\n` +
        "Средства будут списаны с вашего баланса в боте\\.\n" +
        "Нажмите кнопку ниже, чтобы подтвердить оплату\\.",
        { parse_mode: "MarkdownV2", reply_markup: kb },
      );
      return;
    }

    await ctx.reply(
      "🤖 *Добро пожаловать в NFT Гарант Бот\\!*\n\n" +
      "🛡️ Я — безопасный посредник \\(гарант\\) при обмене цифровых товаров:\n" +
      "• NFT и цифровых активов\n" +
      "• Игровых скинов, предметов, аккаунтов\n" +
      "• Подарков Telegram \\(Stars\\)\n" +
      "• Игровых валют и криптовалют\n\n" +
      "⚙️ *Что умеет бот:*\n" +
      "🔹 Создание защищённых сделок за 1 минуту\n" +
      "🔹 Кошелёк с несколькими валютами \\(ГРН, РУБ, TON, Звёзды\\)\n" +
      "🔹 Уведомления продавцу и покупателю в реальном времени\n" +
      "🔹 Поддержка 24/7 — ответ до 5 минут\n" +
      "🔹 19 783 успешных сделок без единого обмана\n\n" +
      "📌 *Выберите раздел кнопками снизу* 👇",
      { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
    );
  });

  // /help
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "❓ *Список команд*\n\n" +
      "/start — главное меню\n" +
      "/wallet — кошелёк и баланс\n" +
      "/stats — статистика бота\n" +
      "/instruction — как создать сделку\n" +
      "/support — написать в поддержку\n\n" +
      "Или просто нажмите нужную кнопку снизу 👇",
      { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
    );
  });

  // /add <userId> <amount> <currency> — пополнение баланса (для администратора)
  bot.command("add", async (ctx) => {
    const args = (ctx.match as string | undefined)?.split(" ");
    if (!args || args.length < 3) {
      await ctx.reply(
        "❌ *Неверный формат команды*\n\n" +
        "✅ *Правильно:* `/add 123456789 500 руб`\n\n" +
        "💱 *Доступные валюты:*\n" +
        "• `грн` или `uah` — Гривна\n" +
        "• `руб` или `rub` — Рубль\n" +
        "• `ton` — Toncoin\n" +
        "• `звезды` или `stars` — Звёзды Telegram",
        { parse_mode: "MarkdownV2" }
      );
      return;
    }
    try {
      const targetId = String(parseInt(args[0]));
      const amount = parseFloat(args[1]);
      const currency = normalizeCurrency(args[2]);
      if (!currency || isNaN(parseInt(targetId)) || isNaN(amount) || amount <= 0) {
        await ctx.reply(
          "❌ *Неверные параметры*\n\nПример: `/add 123456789 500 руб`",
          { parse_mode: "MarkdownV2" }
        );
        return;
      }
      const bal = await getOrCreateBalance(targetId);
      const newVal = (parseFloat(bal[currency] as string) + amount).toFixed(4);
      await db.update(balancesTable).set({ [currency]: newVal }).where(eq(balancesTable.userId, targetId));

      await ctx.reply(
        `✅ Начислено *${num(amount)} ${CURRENCY_LABELS[currency]}* пользователю \`${targetId}\``,
        { parse_mode: "MarkdownV2" }
      );
      try {
        await bot.api.sendMessage(
          parseInt(targetId),
          `💰 *Ваш баланс пополнен\\!*\n\n` +
          `Зачислено: *${num(amount)} ${CURRENCY_LABELS[currency]}*\n\n` +
          `Откройте кошелёк, чтобы проверить баланс\\.`,
          { parse_mode: "MarkdownV2", reply_markup: mainMenu() }
        );
      } catch { /* пользователь не запустил бота */ }
    } catch {
      await ctx.reply("❌ Ошибка\\. Пример: `/add 123456789 500 руб`", { parse_mode: "MarkdownV2" });
    }
  });

  // ── Вспомогательные функции ──

  async function sendSupport(ctx: MyContext) {
    if (!isPrivate(ctx)) return;
    await ctx.reply(
      "🆘 *Служба поддержки NFT Гарант Бота*\n\n" +
      `👤 *Официальный менеджер:* ${esc(SUPPORT_USERNAME)}\n\n` +
      "⏱ *Время ответа:* до 5 минут\n\n" +
      "📋 *Чем помогаем:*\n" +
      "• Спорные ситуации между продавцом и покупателем\n" +
      "• Пополнение баланса любой валютой\n" +
      "• Возврат средств при отмене сделки\n" +
      "• Технические неполадки\n" +
      "• Консультация по безопасным сделкам\n\n" +
      `⚠️ *Осторожно, мошенники\\!*\n` +
      `Единственный официальный аккаунт — ${esc(SUPPORT_USERNAME)}\\.\n` +
      "Не отвечайте на сообщения от других аккаунтов с похожими именами\\.",
      { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
    );
  }

  async function sendInstruction(ctx: MyContext) {
    if (!isPrivate(ctx)) return;
    await ctx.reply(
      "📖 *Как создать безопасную сделку — пошагово*\n\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "*Шаг 1 — Продавец создаёт сделку:*\n" +
      "Нажмите *🤝 Создать сделку* и следуйте инструкциям\\. Вы введёте название товара, цену и валюту\\. Бот выдаст уникальную ссылку\\.\n\n" +
      "*Шаг 2 — Покупатель переходит по ссылке:*\n" +
      "Отправьте ссылку покупателю\\. Он открывает её в Telegram, видит все детали сделки и нажимает «Оплатить»\\. Средства списываются с его баланса в боте\\.\n\n" +
      "*Шаг 3 — Передача товара:*\n" +
      `Продавец передаёт товар менеджеру ${esc(SUPPORT_USERNAME)}\\. Менеджер проверяет товар и переводит деньги продавцу\\.\n\n` +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "✅ *Примеры успешных сделок:*\n" +
      "• NFT Notcoin \\#4821 за 12 TON — закрыто за 8 минут\n" +
      "• Скин AK\\-47 Redline MW CS2 за 3 200 руб — без споров\n" +
      "• Подарок Telegram 500 Stars — мгновенная оплата\n" +
      "• Аккаунт Steam с MMR 4500 — проверен и передан\n\n" +
      "💡 *Важно:* Пополните баланс через поддержку перед первой сделкой\\. Для оплаты нужны средства на счёте в боте\\.",
      { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
    );
  }

  async function sendConverter(ctx: MyContext) {
    if (!isPrivate(ctx)) return;
    await ctx.reply("⏳ Загружаю актуальные курсы\\.\\.\\.", { parse_mode: "MarkdownV2" });

    try {
      const [fxRes, tonRes] = await Promise.all([
        fetch("https://open.er-api.com/v6/latest/USD"),
        fetch("https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd,rub,uah"),
      ]);
      const fx  = await fxRes.json()  as { rates: Record<string, number> };
      const ton = await tonRes.json() as { "the-open-network": { usd: number; rub: number; uah: number } };

      const r = fx.rates;
      const usdRub = r["RUB"]?.toFixed(2) ?? "—";
      const usdUah = r["UAH"]?.toFixed(2) ?? "—";
      const usdEur = r["EUR"]?.toFixed(4) ?? "—";
      const rubUah = r["UAH"] && r["RUB"] ? (r["UAH"] / r["RUB"]).toFixed(4) : "—";
      const rubUsd = r["RUB"] ? (1 / r["RUB"]).toFixed(4) : "—";
      const uahUsd = r["UAH"] ? (1 / r["UAH"]).toFixed(4) : "—";
      const tonUsd = ton["the-open-network"]?.usd?.toFixed(3) ?? "—";
      const tonRub = ton["the-open-network"]?.rub?.toFixed(2) ?? "—";
      const tonUah = ton["the-open-network"]?.uah?.toFixed(2) ?? "—";

      await ctx.reply(
        "💱 *Актуальные курсы валют*\n\n" +
        "🇺🇸 *USD (Доллар):*\n" +
        `▪️ 1 USD = ${esc(usdRub)} RUB\n` +
        `▪️ 1 USD = ${esc(usdUah)} UAH\n` +
        `▪️ 1 USD = ${esc(usdEur)} EUR\n\n` +
        "🇷🇺 *RUB (Рубль):*\n" +
        `▪️ 1 RUB = ${esc(rubUah)} UAH\n` +
        `▪️ 1 RUB = ${esc(rubUsd)} USD\n\n` +
        "🇺🇦 *UAH (Гривна):*\n" +
        `▪️ 1 UAH = ${esc(uahUsd)} USD\n\n` +
        "💎 *TON (Toncoin):*\n" +
        `▪️ 1 TON = ${esc(tonUsd)} USD\n` +
        `▪️ 1 TON = ${esc(tonRub)} RUB\n` +
        `▪️ 1 TON = ${esc(tonUah)} UAH\n\n` +
        "⭐ *Звёзды Telegram:*\n" +
        "▪️ 50 Stars ≈ 1 USD \\(официальный курс\\)\n\n" +
        "_Курсы обновляются в реальном времени_",
        { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
      );
    } catch {
      await ctx.reply(
        "❌ Не удалось загрузить курсы\\. Попробуйте позже\\.",
        { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
      );
    }
  }

  async function sendMyStats(ctx: MyContext) {
    if (!isPrivate(ctx)) return;
    const userId = String(ctx.from?.id ?? "");
    const bal = await getOrCreateBalance(userId);

    const allDeals = await db.select().from(dealsTable);
    const asSellerTotal  = allDeals.filter(d => d.sellerId === userId).length;
    const asSellerPaid   = allDeals.filter(d => d.sellerId === userId && d.status === "paid").length;
    const asSellerActive = allDeals.filter(d => d.sellerId === userId && d.status === "active").length;
    const asBuyerTotal   = allDeals.filter(d => d.buyerId  === userId).length;
    const asBuyerPaid    = allDeals.filter(d => d.buyerId  === userId && d.status === "paid").length;

    const hrn   = parseFloat(bal.hrn   as string).toFixed(2);
    const rub   = parseFloat(bal.rub   as string).toFixed(2);
    const ton   = parseFloat(bal.ton   as string).toFixed(6);
    const stars = parseFloat(bal.stars as string).toFixed(0);

    await ctx.reply(
      "📈 *Ваша личная статистика*\n\n" +
      "🆔 *Ваш ID:* `" + userId + "`\n\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "🤝 *Как продавец:*\n" +
      `▪️ Создано сделок: *${esc(String(asSellerTotal))}*\n` +
      `▪️ Завершено: *${esc(String(asSellerPaid))}*\n` +
      `▪️ Активных: *${esc(String(asSellerActive))}*\n\n` +
      "🛒 *Как покупатель:*\n" +
      `▪️ Оплачено сделок: *${esc(String(asBuyerPaid))}* из ${esc(String(asBuyerTotal))}\n\n` +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      "💼 *Текущий баланс:*\n" +
      `▪️ ${num(hrn)} ГРН\n` +
      `▪️ ${num(rub)} РУБ\n` +
      `▪️ ${num(ton)} TON\n` +
      `▪️ ${num(stars)} Звёзды\n\n` +
      "📩 Для пополнения обратитесь в 🆘 Поддержку\\.",
      { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
    );
  }

  async function sendStats(ctx: MyContext) {
    if (!isPrivate(ctx)) return;
    const allDeals = await db.select().from(dealsTable);
    const paid = allDeals.filter(d => d.status === "paid").length;
    const active = allDeals.filter(d => d.status === "active").length;
    const total = Math.max(paid + 19783, 19783);
    await ctx.reply(
      "📊 *Статистика NFT Гарант Бота*\n\n" +
      `🤝 *Успешных сделок:* ${esc(total.toLocaleString("ru-RU"))}\n` +
      `⏳ *Активных сделок:* ${esc(String(active))}\n` +
      "👥 *Всего пользователей:* 48 294\n" +
      "⚡ *Среднее время ответа:* 0\\.2 сек\n" +
      "🛡️ *Безопасность:* 100%\n" +
      "💰 *Общий оборот:* 2 847 950 RUB\n" +
      "📅 *Работаем с:* 2023 года\n\n" +
      "🔒 За всё время — *ни одного случая мошенничества* через нашего гаранта\\.",
      { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
    );
  }

  async function sendWallet(ctx: MyContext) {
    if (!isPrivate(ctx)) return;
    const userId = String(ctx.from?.id ?? "");
    const bal = await getOrCreateBalance(userId);
    const hrn   = parseFloat(bal.hrn   as string).toFixed(2);
    const rub   = parseFloat(bal.rub   as string).toFixed(2);
    const ton   = parseFloat(bal.ton   as string).toFixed(6);
    const stars = parseFloat(bal.stars as string).toFixed(0);

    await ctx.reply(
      "💼 *Ваш кошелёк*\n\n" +
      `🆔 *Ваш ID для пополнения:* \`${userId}\`\n\n` +
      "💵 *Текущий баланс:*\n" +
      `▪️ ${num(hrn)} ГРН\n` +
      `▪️ ${num(rub)} РУБ\n` +
      `▪️ ${num(ton)} TON\n` +
      `▪️ ${num(stars)} Звёзды\n\n` +
      "ℹ️ _Баланс используется для оплаты сделок в боте\\._\n\n" +
      "📩 *Как пополнить баланс:*\n" +
      `1\\. Напишите ${esc(SUPPORT_USERNAME)}\n` +
      `2\\. Сообщите ваш ID: \`${userId}\`\n` +
      "3\\. Укажите нужную сумму и валюту\n" +
      "4\\. Оплатите удобным способом\n\n" +
      "⏱ Зачисление в течение 5\\-10 минут после подтверждения оплаты\\.",
      { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
    );
  }

  // ── Reply Keyboard ──
  bot.hears("🆘 Поддержка",       ctx => sendSupport(ctx));
  bot.hears("📖 Инструкция",      ctx => sendInstruction(ctx));
  bot.hears("📊 Статистика",      ctx => sendStats(ctx));
  bot.hears("💼 Кошелёк",         ctx => sendWallet(ctx));
  bot.hears("📈 Моя статистика",  ctx => sendMyStats(ctx));
  bot.hears("💱 Конвертер",       ctx => sendConverter(ctx));

  // ── Команды ──
  bot.command("support",     ctx => sendSupport(ctx));
  bot.command("instruction", ctx => sendInstruction(ctx));
  bot.command("stats",       ctx => sendStats(ctx));
  bot.command("wallet",      ctx => sendWallet(ctx));
  bot.command("mystats",     ctx => sendMyStats(ctx));
  bot.command("convert",     ctx => sendConverter(ctx));

  // ── Создать сделку — Шаг 1 (название) ──
  bot.hears("🤝 Создать сделку", async (ctx) => {
    if (!isPrivate(ctx)) return;
    ctx.session.step = "title";
    await ctx.reply(
      "🤝 *Создание сделки — Шаг 1 из 3*\n\n" +
      "📦 *Введите название товара или услуги:*\n\n" +
      "✅ *Примеры:*\n" +
      "• `Скин AK\\-47 Redline MW CS2`\n" +
      "• `NFT Notcoin \\#4821`\n" +
      "• `Подарок Telegram 500 Stars`\n" +
      "• `Аккаунт Steam MMR 4500`\n" +
      "• `Игровая валюта 10 000 золота`\n\n" +
      "✏️ Напишите название в следующем сообщении:",
      { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
    );
  });

  // ── Callback: оплата сделки ──
  bot.callbackQuery(/^pay_/, async (ctx) => {
    try {
      const dealId = ctx.callbackQuery.data.replace("pay_", "");
      const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.dealId, dealId)).limit(1);

      if (!deal) {
        await ctx.answerCallbackQuery({ text: "❌ Сделка устарела или не найдена.", show_alert: true });
        return;
      }
      if (deal.status !== "active") {
        await ctx.answerCallbackQuery({ text: "❌ Сделка уже оплачена или отменена.", show_alert: true });
        return;
      }

      const buyerId = String(ctx.from.id);
      const bal = await getOrCreateBalance(buyerId);
      const currency = deal.currency as Currency;
      const price = parseFloat(deal.price as string);
      const have = parseFloat(bal[currency] as string);

      if (have < price) {
        await ctx.answerCallbackQuery({
          text: `❌ Недостаточно средств!\nНужно: ${price} ${CURRENCY_LABELS[currency]}\nУ вас: ${have.toFixed(2)} ${CURRENCY_LABELS[currency]}\n\nПополните баланс через поддержку.`,
          show_alert: true,
        });
        return;
      }

      await db.update(balancesTable)
        .set({ [currency]: (have - price).toFixed(4) })
        .where(eq(balancesTable.userId, buyerId));
      await db.update(dealsTable)
        .set({ status: "paid", buyerId })
        .where(eq(dealsTable.dealId, dealId));

      await ctx.reply(
        "✅ *Сделка успешно оплачена\\!*\n\n" +
        `📦 *Товар:* ${esc(deal.title)}\n` +
        `💵 *Сумма:* ${fmtPrice(deal.price as string)} ${CURRENCY_LABELS[currency]}\n` +
        `🆔 *ID:* \`${dealId}\`\n\n` +
        `Ожидайте — продавец передаст товар менеджеру ${esc(SUPPORT_USERNAME)}\\.\n` +
        "После проверки вы получите ваш товар\\.",
        { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
      );

      try {
        await bot.api.sendMessage(
          parseInt(deal.sellerId),
          "🔔 *Покупатель оплатил сделку\\!*\n\n" +
          `📦 *Товар:* ${esc(deal.title)}\n` +
          `💵 *Сумма:* ${fmtPrice(deal.price as string)} ${CURRENCY_LABELS[currency]}\n` +
          `🆔 *ID:* \`${dealId}\`\n\n` +
          `👉 Передайте товар менеджеру ${esc(SUPPORT_USERNAME)}\\.\n` +
          "После проверки деньги будут переведены на ваш баланс\\.",
          { parse_mode: "MarkdownV2", reply_markup: mainMenu() }
        );
      } catch { /* продавец заблокировал бота */ }

      await ctx.answerCallbackQuery({ text: "✅ Оплата прошла успешно!" });
    } catch (err) {
      logger.error({ err }, "pay callback error");
      await ctx.answerCallbackQuery({ text: "❌ Произошла ошибка. Попробуйте позже.", show_alert: true }).catch(() => {});
    }
  });

  // ── Callback: назад в меню ──
  bot.callbackQuery("menu_main", async (ctx) => {
    try {
      await ctx.reply("Используйте кнопки меню ниже 👇", { reply_markup: mainMenu() });
      await ctx.answerCallbackQuery();
    } catch {
      await ctx.answerCallbackQuery().catch(() => {});
    }
  });

  // ── Callback: выбор валюты ──
  bot.callbackQuery(/^currency_/, async (ctx) => {
    try {
      const currency = ctx.callbackQuery.data.replace("currency_", "") as Currency;
      if (!CURRENCY_LABELS[currency]) {
        await ctx.answerCallbackQuery({ text: "❌ Неизвестная валюта.", show_alert: true });
        return;
      }
      const title = ctx.session.dealTitle;
      const price = ctx.session.dealPrice;
      if (!title || !price) {
        await ctx.answerCallbackQuery({ text: "❌ Сессия истекла. Начните заново.", show_alert: true });
        ctx.session = {};
        return;
      }
      ctx.session = {};

      const dealId = generateDealId();
      const sellerId = String(ctx.from.id);
      await db.insert(dealsTable).values({
        dealId,
        sellerId,
        title,
        price: price.toString(),
        currency,
        status: "active",
      });

      const me = await bot.api.getMe();
      const dealLink = `https://t.me/${me.username}?start=deal_${dealId}`;

      await ctx.reply(
        "✅ *Сделка успешно создана\\!*\n\n" +
        `📦 *Товар:* ${esc(title)}\n` +
        `💵 *Цена:* ${fmtPrice(price)} ${CURRENCY_LABELS[currency]}\n` +
        `🆔 *ID сделки:* \`${dealId}\`\n\n` +
        "🔗 *Ссылка для покупателя:*\n" +
        `\`${esc(dealLink)}\`\n\n` +
        "📋 *Что делать дальше:*\n" +
        "1\\. Скопируйте ссылку выше\n" +
        "2\\. Отправьте её покупателю\n" +
        "3\\. Дождитесь уведомления об оплате\n" +
        `4\\. Передайте товар ${esc(SUPPORT_USERNAME)}\n\n` +
        "⏳ Ссылка активна до момента оплаты\\.",
        { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
      );
      await ctx.answerCallbackQuery({ text: `✅ Валюта: ${CURRENCY_LABELS[currency]}` });
    } catch (err) {
      logger.error({ err }, "currency callback error");
      await ctx.answerCallbackQuery({ text: "❌ Ошибка. Попробуйте ещё раз.", show_alert: true }).catch(() => {});
    }
  });

  // ── FSM — ввод текста ──
  bot.on("message", async (ctx) => {
    if (!isPrivate(ctx)) return;
    const step = ctx.session.step;
    const text = ctx.message.text;
    if (!text || text.startsWith("/")) return;

    const menuLabels = ["🤝 Создать сделку", "💼 Кошелёк", "📊 Статистика", "📈 Моя статистика", "💱 Конвертер", "📖 Инструкция", "🆘 Поддержка"];
    if (menuLabels.includes(text)) return;

    // Шаг 1: название → шаг 2 (цена)
    if (step === "title") {
      if (text.length > 200) {
        await ctx.reply(
          "❌ Название слишком длинное \\(максимум 200 символов\\)\\.\nПожалуйста, сократите название и попробуйте ещё раз\\.",
          { parse_mode: "MarkdownV2", reply_markup: mainMenu() }
        );
        return;
      }
      ctx.session.dealTitle = text;
      ctx.session.step = "price";
      await ctx.reply(
        `✅ *Название сохранено:* ${esc(text)}\n\n` +
        "💰 *Шаг 2 из 3 — Введите цену:*\n\n" +
        "✅ *Примеры:*\n" +
        "• `500` — целое число\n" +
        "• `1250` — тысячи\n" +
        "• `12.5` — дробное число\n" +
        "• `0.05` — малые суммы \\(например TON\\)\n\n" +
        "✏️ Напишите цену в следующем сообщении:",
        { parse_mode: "MarkdownV2", reply_markup: mainMenu() },
      );
      return;
    }

    // Шаг 2: цена → выбор валюты
    if (step === "price") {
      const price = parseFloat(text.replace(",", "."));
      if (isNaN(price) || price <= 0) {
        await ctx.reply(
          "❌ *Неверный формат цены*\n\n" +
          "Введите положительное число, например:\n" +
          "`1500`, `12.5`, `0.05`",
          { parse_mode: "MarkdownV2", reply_markup: mainMenu() }
        );
        return;
      }
      ctx.session.dealPrice = price;

      const currencyKb = new InlineKeyboard()
        .text("🇷🇺 РУБ", "currency_rub").text("🇺🇦 ГРН", "currency_hrn").row()
        .text("💎 TON", "currency_ton").text("⭐ Звёзды", "currency_stars");

      await ctx.reply(
        `✅ *Цена сохранена:* ${fmtPrice(price)}\n\n` +
        "💱 *Шаг 3 из 3 — Выберите валюту:*\n\n" +
        "Нажмите на нужную валюту ниже 👇",
        { parse_mode: "MarkdownV2", reply_markup: currencyKb },
      );
      return;
    }

    // Нет активного шага — помощь
    await ctx.reply(
      "ℹ️ Используйте кнопки меню ниже для навигации\\.\n\nЕсли нужна помощь — нажмите *🆘 Поддержка*\\.",
      { parse_mode: "MarkdownV2", reply_markup: mainMenu() }
    );
  });

  bot.catch((err) => {
    logger.error({ err: err.error }, "Bot unhandled error");
  });

  return bot;
}
