const config = require("../src/config");
const { openDatabase, audit } = require("../src/db");
const { hashPassword } = require("../src/auth");
const { nowIso } = require("../src/util");

const [username, password] = process.argv.slice(2);

if (!username || !password || password.length < 8) {
  console.error("用法：npm run reset-password -- <用户名> <至少8位的新密码>");
  process.exit(1);
}

const db = openDatabase(config.dbPath);
const user = db.prepare("SELECT id, username, display_name FROM users WHERE username = ?").get(username);

if (!user) {
  console.error(`用户不存在：${username}`);
  db.close();
  process.exit(1);
}

db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
  hashPassword(password),
  nowIso(),
  user.id
);
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
audit(db, null, "user.password_reset_cli", "user", user.id);
db.close();

console.log(`已重置 ${user.display_name}（${username}）的密码，并注销其所有登录。`);
