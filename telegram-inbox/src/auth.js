const crypto = require("node:crypto");
const { parseCookies, randomToken, sha256, toPublicUser } = require("./util");

const COOKIE_NAME = "tg_inbox_sid";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    hash.toString("base64")
  ].join("$");
}

function verifyPassword(password, stored) {
  try {
    const [algorithm, n, r, p, saltBase64, hashBase64] = String(stored || "").split("$");
    if (algorithm !== "scrypt") return false;
    const salt = Buffer.from(saltBase64, "base64");
    const expected = Buffer.from(hashBase64, "base64");
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createSession(db, userId, days) {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(tokenHash, userId, expiresAt, now.toISOString());

  return { token, expiresAt };
}

function destroySession(db, token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

function destroyUserSessions(db, userId, exceptTokenHash = null) {
  if (exceptTokenHash) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, exceptTokenHash);
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}

function cookieOptions(req, config, maxAgeSeconds) {
  let secure = false;
  if (config.cookieSecure === true) secure = true;
  else if (config.cookieSecure === false) secure = false;
  else secure = Boolean(req.secure || req.get("x-forwarded-proto") === "https");

  const parts = [
    `Path=/`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function setSessionCookie(req, res, token, days, config) {
  const maxAge = days * 24 * 60 * 60;
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions(req, config, maxAge)}`
  );
}

function clearSessionCookie(req, res, config) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; ${cookieOptions(req, config, 0)}`);
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie || "")[COOKIE_NAME] || "";
}

function attachUser(db) {
  return (req, res, next) => {
    const token = getSessionToken(req);
    if (!token) return next();

    const tokenHash = sha256(token);
    const row = db.prepare(
      `SELECT s.token_hash, s.expires_at,
              u.id, u.username, u.display_name, u.role, u.active,
              u.ai_allowed, u.ai_enabled, u.ai_mode, u.totp_enabled, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    ).get(tokenHash);

    if (!row || row.expires_at <= new Date().toISOString() || !row.active) {
      if (row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return next();
    }

    req.user = toPublicUser(row);
    req.session = { tokenHash, expiresAt: row.expires_at };
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "请先登录" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "请先登录" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  next();
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  destroyUserSessions,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  attachUser,
  requireAuth,
  requireAdmin
};
