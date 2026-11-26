const config = require("./src/config");
const { createLogger } = require("./src/util");
const { openDatabase, bootstrapAdmin } = require("./src/db");
const { createBroadcaster } = require("./src/realtime");
const { createTelegramService } = require("./src/telegram");
const { createWhatsAppService } = require("./src/whatsapp");
const { createWhatsAppWebService } = require("./src/whatsapp-web");
const { createAccountsService } = require("./src/accounts");
const { createTranslateService } = require("./src/translate");
const { createAIService } = require("./src/ai");
const { createApp } = require("./src/app");

const logger = createLogger(config.logLevel);

async function main() {
  const db = openDatabase(config.dbPath);
  const bootstrap = bootstrapAdmin(db, config);

  if (bootstrap.created) {
    logger.info(`已创建初始管理员：${bootstrap.username}`);
    if (bootstrap.generated) {
      logger.warn("============================================================");
      logger.warn(`初始管理员密码：${bootstrap.password}`);
      logger.warn("请登录后立即修改密码，或在 .env 中设置 ADMIN_PASSWORD 后重建。");
      logger.warn("============================================================");
    }
  }

  const broadcaster = createBroadcaster(logger);
  const translate = createTranslateService({ db, config, logger });
  const hooks = {};
  const telegram = createTelegramService({ db, config, logger, broadcaster, translate, hooks });
  const whatsapp = createWhatsAppService({ db, config, logger, broadcaster, translate, hooks });
  const whatsappWeb = createWhatsAppWebService({ db, config, logger, broadcaster, translate, hooks });
  const accounts = createAccountsService({ db, config, logger, broadcaster, translate, hooks });
  const ai = createAIService({
    db,
    config,
    logger,
    broadcaster,
    sendReply: (conversation, text, user, options) => {
      if (conversation.account_id) {
        return accounts.sendReply(conversation, text, user, options);
      }
      const channel = conversation.channel || "telegram";
      const service = channel === "whatsapp" ? whatsapp
        : channel === "whatsapp_web" ? whatsappWeb
          : telegram;
      return service.sendReply(conversation, text, user, options);
    }
  });
  hooks.onInbound = event => ai.handleInbound(event);
  const app = createApp({ db, config, telegram, whatsapp, whatsappWeb, accounts, broadcaster, logger, translate, ai });

  const server = app.listen(config.port, config.host, () => {
    logger.info(`Telegram 客服收件箱已启动：http://${config.host}:${config.port}`);
    logger.info(`数据库：${config.dbPath}`);
    logger.info(`Telegram Bot：${telegram.configured ? "已配置" : "未配置（只能查看已有数据）"}`);
    logger.info(`WhatsApp Cloud API：${whatsapp.configured ? "已配置" : "未配置"}`);
    logger.info(`WhatsApp 个人号：${whatsappWeb.status().enabled ? (whatsappWeb.configured ? "已登录" : "已启用，等待扫码") : "未启用"}`);
    logger.info(`个人号模式：${accounts.enabled ? "已启用" : "未启用"}`);
    logger.info(`Google 翻译：${translate.configured() ? "已配置" : "未配置"}`);
    logger.info(`AI 自动回复：${ai.configured() ? (ai.status().enabled ? "已启用" : "已配置，总开关关闭") : "未配置"}`);
  });

  server.on("error", error => {
    logger.error("HTTP 服务启动失败", error.message);
    process.exitCode = 1;
  });

  ai.resumeQueued();

  telegram.start().catch(error => {
    logger.error("Telegram 轮询启动失败", error.message);
  });

  whatsappWeb.start().catch(error => {
    logger.error("WhatsApp 个人号启动失败", error.message);
  });

  accounts.startAll().catch(error => {
    logger.error("个人号账号启动失败", error.message);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收到 ${signal}，正在关闭服务…`);
    ai.close();
    broadcaster.close();
    await Promise.allSettled([telegram.stop(), whatsappWeb.stop(), accounts.stopAll()]);
    server.close(() => {
      try {
        db.close();
      } catch {}
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", error => {
    logger.error("未处理的 Promise 拒绝", error?.message || String(error));
  });
}

if (require.main === module) {
  main().catch(error => {
    logger.error("启动失败", error.message);
    process.exit(1);
  });
}

module.exports = { main };
