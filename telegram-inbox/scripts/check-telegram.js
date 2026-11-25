const config = require("../src/config");
const { TelegramClient } = require("../src/telegram");
const { createLogger } = require("../src/util");

async function main() {
  const client = new TelegramClient({
    token: config.telegramToken,
    apiBase: config.telegramApiBase,
    logger: createLogger("error")
  });

  if (!client.configured) {
    console.error("未配置 TELEGRAM_BOT_TOKEN。请复制 .env.example 为 .env，填入 BotFather 提供的 Token 后再试。");
    process.exit(1);
  }

  const me = await client.getMe();
  console.log(`Token 有效：@${me.username || "(无用户名)"} / ${me.first_name || ""}`);
  console.log(`Bot ID：${me.id}`);
  console.log("下一步：运行 npm start，然后给机器人发一条私聊消息。");
}

main().catch(error => {
  console.error(`Token 检查失败：${error.message}`);
  process.exit(1);
});
