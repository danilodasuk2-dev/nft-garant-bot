import app from "./app";
import { logger } from "./lib/logger";
import { createBot } from "./bot";
import { webhookCallback } from "grammy";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const isProduction = process.env.NODE_ENV === "production";

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  const bot = createBot();
  if (!bot) return;

  if (isProduction) {
    // Webhook mode — Telegram sends updates to us, no persistent connection needed
    const domains = process.env.REPLIT_DOMAINS;
    const domain = domains?.split(",")[0]?.trim();

    if (!domain) {
      logger.error("REPLIT_DOMAINS not set — cannot register webhook");
      return;
    }

    const webhookUrl = `https://${domain}/api/telegram`;

    // Register webhook handler on Express
    app.post("/api/telegram", webhookCallback(bot, "express"));

    // Tell Telegram where to send updates
    await bot.api.setWebhook(webhookUrl, { drop_pending_updates: true });
    logger.info({ webhookUrl }, "Telegram webhook registered");
  } else {
    // Long polling for local development
    bot.start({
      onStart: (info) => logger.info({ username: info.username }, "Telegram bot started (polling)"),
    });
    logger.info("Telegram bot launched via long polling");
  }
});
