const config = require("./src/config");
const { createLogger } = require("./src/util");
const { openDatabase, bootstrapAdmin } = require("./src/db");
const { createBroadcaster } = require("./src/realtime");
const { createTelegramService } = require("./src/telegram");
const { createWhatsAppService } = require("./src/whatsapp");
const { createTranslateService } = require("./src/translate");
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
  const telegram = createTelegramService({ db, config, logger, broadcaster, translate });
  const whatsapp = createWhatsAppService({ db, config, logger, broadcaster, translate });
  const app = createApp({ db, config, telegram, whatsapp, broadcaster, logger, translate });

  const server = app.listen(config.port, config.host, () => {
    logger.info(`Telegram 客服收件箱已启动：http://${config.host}:${config.port}`);
    logger.info(`数据库：${config.dbPath}`);
    logger.info(`Telegram Bot：${telegram.configured ? "已配置" : "未配置（只能查看已有数据）"}`);
    logger.info(`WhatsApp Cloud API：${whatsapp.configured ? "已配置" : "未配置"}`);
    logger.info(`Google 翻译：${translate.configured() ? "已配置" : "未配置"}`);
  });

  server.on("error", error => {
    logger.error("HTTP 服务启动失败", error.message);
    process.exitCode = 1;
  });

  telegram.start().catch(error => {
    logger.error("Telegram 轮询启动失败", error.message);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`收到 ${signal}，正在关闭服务…`);
    broadcaster.close();
    await telegram.stop();
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
