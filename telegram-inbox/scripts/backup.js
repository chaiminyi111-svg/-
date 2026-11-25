const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const config = require("../src/config");

const dbPath = config.dbPath;
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(config.dataDir, "backups"));
const keepDays = Math.max(Number.parseInt(process.env.BACKUP_KEEP_DAYS || "14", 10) || 14, 1);

if (!fs.existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const target = path.join(backupDir, `inbox-${stamp}.db`);

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
db.close();
fs.copyFileSync(dbPath, target);

const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
for (const name of fs.readdirSync(backupDir)) {
  if (!name.startsWith("inbox-") || !name.endsWith(".db")) continue;
  const file = path.join(backupDir, name);
  if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
}

console.log(`备份完成：${target}`);
console.log(`保留最近 ${keepDays} 天的备份，目录：${backupDir}`);
