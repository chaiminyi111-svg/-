const crypto = require("node:crypto");
const net = require("node:net");
const { getSetting, setSetting } = require("./db");

const IP_ALLOWLIST_KEY = "admin_ip_allowlist";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const clean = String(input || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("无效的 Base32 密钥");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(Math.max(10, Math.min(Number(bytes) || 20, 64))));
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, "0");
}

function totpCode(secret, timestamp = Date.now()) {
  return hotp(secret, Math.floor(timestamp / 30000));
}

function verifyTotp(secret, code, window = 1) {
  const normalized = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized) || !secret) return false;
  const step = Math.floor(Date.now() / 30000);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secret, step + offset);
    if (expected.length === normalized.length && crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(normalized)
    )) return true;
  }
  return false;
}

function otpauthUrl({ issuer = "聚合客服台", account, secret }) {
  const label = `${issuer}:${account}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

function normalizeIp(value) {
  let ip = String(value || "").trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  return ip;
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((result, part) => ((result << 8) + Number(part)) >>> 0, 0);
}

function ipv6ToBigInt(ip) {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const parts = [...left, ...Array(missing).fill("0"), ...right];
  let value = 0n;
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    value = (value << 16n) + BigInt(parseInt(part, 16));
  }
  return value;
}

function parseAllowlistEntry(raw) {
  const entry = String(raw || "").trim();
  if (!entry) return null;
  const [base, bitsRaw] = entry.split("/");
  const version = net.isIP(base);
  if (!version) throw new Error(`无效 IP：${entry}`);
  if (bitsRaw === undefined) {
    return { type: version === 4 ? "ipv4" : "ipv6", value: version === 4 ? ipv4ToInt(base) : normalizeIp(base).toLowerCase(), text: entry };
  }
  const bits = Number(bitsRaw);
  if (version === 4 && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return { type: "cidr4", network: ipv4ToInt(base) & mask, mask, text: entry };
  }
  if (version === 6 && Number.isInteger(bits) && bits >= 0 && bits <= 128) {
    const value = ipv6ToBigInt(normalizeIp(base));
    if (value === null) throw new Error(`无效 IPv6：${entry}`);
    const mask = bits === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);
    return { type: "cidr6", network: value & mask, mask, text: entry };
  }
  throw new Error(`无效 CIDR：${entry}`);
}

function parseAllowlist(text) {
  const entries = String(text || "")
    .split(/[\n,，\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(parseAllowlistEntry)
    .filter(Boolean);
  return [...new Map(entries.map(item => [item.text, item])).values()];
}

function isIpAllowed(ip, entries) {
  const normalized = normalizeIp(ip);
  const version = net.isIP(normalized);
  if (!version || !entries?.length) return !entries?.length;
  if (version === 4) {
    const value = ipv4ToInt(normalized);
    return entries.some(entry =>
      (entry.type === "ipv4" && entry.value === value)
      || (entry.type === "cidr4" && (value & entry.mask) === entry.network)
    );
  }
  const value = ipv6ToBigInt(normalized);
  if (value === null) return false;
  return entries.some(entry =>
    (entry.type === "ipv6" && entry.value === normalized.toLowerCase())
    || (entry.type === "cidr6" && (value & entry.mask) === entry.network)
  );
}

function getAdminIpAllowlist(db) {
  const raw = getSetting(db, IP_ALLOWLIST_KEY, "[]");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function setAdminIpAllowlist(db, text) {
  const entries = parseAllowlist(text);
  setSetting(db, IP_ALLOWLIST_KEY, JSON.stringify(entries.map(item => item.text)));
  return entries.map(item => item.text);
}

module.exports = {
  IP_ALLOWLIST_KEY,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCode,
  verifyTotp,
  otpauthUrl,
  normalizeIp,
  parseAllowlist,
  isIpAllowed,
  getAdminIpAllowlist,
  setAdminIpAllowlist
};
