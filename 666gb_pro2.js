#!/usr/bin/env node
/**
 * 🌙 by_moon — Djezzy Bot v13 (JavaScript Port)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ✅ Node.js + grammY (أعلى أداء متوازي)
 * ✅ concurrent_updates = 1000 (معالجة متوازية)
 * ✅ تثبيت تلقائي للمكتبات الناقصة
 * ✅ 🔒 OTP Sticky Session (sessid + same TCP)
 * ✅ 🔄 إعادة إرسال OTP تلقائياً
 * ✅ 🧠 كود خاطئ لا يُنهي الجلسة
 * ✅ إدارة بروكسيات + تدوير تلقائي
 */

"use strict";

// ════════════════════════════════════════════════════════════
// 🔧 التثبيت التلقائي للمكتبات
// ════════════════════════════════════════════════════════════
const { execSync } = require("child_process");
const path = require("path");

function ensureDependencies() {
  const required = {
    "grammy": "^1.30.0",
    "undici": "^6.19.0",
    "socks-proxy-agent": "^8.0.0",
  };
  const pkgPath = path.join(process.cwd(), "package.json");
  let pkg = { dependencies: {} };
  try {
    pkg = require(pkgPath);
    if (!pkg.dependencies) pkg.dependencies = {};
  } catch (_) {}

  const missing = [];
  for (const [name, ver] of Object.entries(required)) {
    try {
      require.resolve(name);
    } catch (_) {
      missing.push(`${name}@${ver}`);
      pkg.dependencies[name] = ver;
    }
  }
  if (missing.length === 0) return;

  console.log(`📦 Installing missing packages: ${missing.join(", ")}`);
  try {
    require("fs").writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    execSync(`npm install ${missing.join(" ")} --no-audit --no-fund --loglevel=error`, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    console.log("✅ All packages installed.");
  } catch (e) {
    console.error("❌ Failed to install dependencies:", e.message);
    process.exit(1);
  }
}
ensureDependencies();

// ════════════════════════════════════════════════════════════
// 📥 Imports
// ════════════════════════════════════════════════════════════
const fs = require("fs");
const crypto = require("crypto");
const { Bot, InlineKeyboard, GrammyError, HttpError, session } = require("grammy");
const { Agent, ProxyAgent, setGlobalDispatcher, request, fetch } = require("undici");
const { SocksProxyAgent } = require("socks-proxy-agent");

// ════════════════════════════════════════════════════════════
// ⚙️ الإعدادات
// ════════════════════════════════════════════════════════════
const BOT_TOKEN = "8344928238:AAEQc572EbLR60C8vmlV1rnso0KkiTKlC9w";
const ADMIN_ID = 1726923679;
const PROOF_CHANNEL_ID = "@by_moon_dz";

const MAX_ACCOUNTS = 3;
const ALLOWED_USERS = [];
const STRICT_SESSION_BINDING = true;

const CLIENT_ID = "87pIExRhxBb3_wGsA5eSEfyATloa";
const CLIENT_SECRET = "uf82p68Bgisp8Yg1Uz8Pf6_v1XYa";
const BASE_URL = "https://apim.djezzy.dz/mobile-api";

const DATA_FILE = "bot_data.json";
const PROXIES_FILE = "proxies.json";

// 🚀 1000 طلب متوازي كما طلبت
const CONCURRENT_UPDATES = 1000;

const WEEKLY_REWARD_KEY = "w2gb";
const WEEKLY_REWARD_COOLDOWN_SECONDS = 7 * 24 * 3600;

const OFFER_DATA = {
  w2gb: { name: "🎁 2GB الأسبوعية", code: "GIFTWALKWIN2GO", type: "reward", price: "مجاني", duration: "7 أيام" },
  w6gb: { name: "⚡ 6GB 24 ساعة", code: "GIFTWALKWIN6GDAY", type: "reward", price: "مجاني", duration: "24 ساعة" },
};

// ════════════════════════════════════════════════════════════
// 🛠️ مساعدات عامة
// ════════════════════════════════════════════════════════════
function mdEscape(text) {
  if (!text) return "";
  return String(text).replace(/([_*`\[\]])/g, "\\$1");
}
function safeMd(text, limit = 4000) {
  if (text.length > limit) text = text.slice(0, limit) + "\n...";
  return text;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── تخزين مؤقت (Debounced Save) ─────────────────────────────
class DebouncedStore {
  constructor(file, defaultValue) {
    this.file = file;
    this.defaultValue = defaultValue;
    this.data = this._load();
    this._pending = false;
    this._timer = null;
  }
  _load() {
    try {
      if (fs.existsSync(this.file)) {
        return JSON.parse(fs.readFileSync(this.file, "utf-8"));
      }
    } catch (e) {
      console.error(`load ${this.file}:`, e.message);
    }
    return JSON.parse(JSON.stringify(this.defaultValue));
  }
  save(delay = 1000) {
    if (this._pending) return;
    this._pending = true;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try {
        const tmp = this.file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
        fs.renameSync(tmp, this.file);
      } catch (e) {
        console.error(`save ${this.file}:`, e.message);
      }
      this._pending = false;
    }, delay);
  }
}

// ════════════════════════════════════════════════════════════
// 🌐 محلّل مدخلات البروكسي
// ════════════════════════════════════════════════════════════
function parseProxyInput(raw) {
  if (!raw || !raw.trim()) return [null, "المدخل فارغ"];
  raw = raw.trim();

  if (/^(https?|socks5):\/\//i.test(raw)) {
    return [raw.split(/\s+/)[0], ""];
  }

  const kv = {};
  const kvRe = /^\s*(\w+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\d+))\s*$/gm;
  let m;
  while ((m = kvRe.exec(raw)) !== null) {
    const name = m[1];
    const value = m[2] ?? m[3] ?? m[4];
    if (value !== null && value !== undefined) kv[name] = value;
  }

  const entryMatch = raw.match(/entry\s*=\s*\(\s*['"]([^'"]+)['"]/);
  if (entryMatch) {
    const template = entryMatch[1];
    try {
      const argsMap = {
        username: kv.username || "",
        password: kv.password || "",
        country: kv.country || "",
        session: kv.session || "",
        sesstime: kv.sesstime || "10",
      };
      const placeholders = template.match(/%[sd]/g) || [];
      const tupleMatch = raw.match(/\)\s*%\s*\(([^)]+)\)/);
      let orderedValues = [];
      if (tupleMatch) {
        const names = tupleMatch[1].split(",").map((n) => n.trim());
        orderedValues = names.map((n) => argsMap[n] || kv[n] || "");
      } else {
        orderedValues = [argsMap.username, argsMap.country, argsMap.session, argsMap.sesstime, argsMap.password];
      }
      if (placeholders.length === orderedValues.length) {
        let built = template;
        for (const val of orderedValues) {
          built = built.replace(placeholders.shift(), String(val));
        }
        return [built, ""];
      }
    } catch (e) {
      console.warn("parse entry template:", e.message);
    }
  }

  const username = kv.username;
  const password = kv.password;
  if (!username || !password) return [null, "لم أجد `username` و `password` في النص"];

  const country = kv.country;
  const sessionId = kv.session;
  const sesstime = kv.sesstime;
  const host = kv.host || "pr.oxylabs.io";
  const port = kv.port || "7777";

  if (country) {
    let userPart = `customer-${username}-cc-${country}`;
    if (sessionId) userPart += `-sessid-${sessionId}`;
    if (sesstime) userPart += `-sesstime-${sesstime}`;
    return [`http://${userPart}:${password}@${host}:${port}`, ""];
  }
  return [`http://${username}:${password}@${host}:${port}`, ""];
}

// ════════════════════════════════════════════════════════════
// 🔒 Sticky proxy
// ════════════════════════════════════════════════════════════
function generateSessionId() {
  return Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join("");
}

function makeStickyProxy(proxyUrl, sessionId) {
  if (!proxyUrl || !proxyUrl.includes("oxylabs.io")) return proxyUrl;
  if (proxyUrl.includes("sessid-")) return proxyUrl;
  sessionId = sessionId || generateSessionId();

  const m = proxyUrl.match(/^(?<scheme>https?:\/\/)(?<userinfo>[^@]+)(?<hostport>@.+)$/);
  if (!m) return proxyUrl;
  const { scheme, userinfo, hostport } = m.groups;

  if (userinfo.includes(":")) {
    const [usr, pwd] = [userinfo.split(":")[0], userinfo.split(":").slice(1).join(":")];
    return `${scheme}${usr}-sessid-${sessionId}-sesstime-10:${pwd}${hostport}`;
  }
  return `${scheme}${userinfo}-sessid-${sessionId}-sesstime-10${hostport}`;
}

// ════════════════════════════════════════════════════════════
// 🌐 ProxyManager
// ════════════════════════════════════════════════════════════
class ProxyManager {
  constructor(file = PROXIES_FILE) {
    this.file = file;
    this.proxies = this._load();
    this._notifiedExhausted = false;
    this._lastNotifiedAt = 0;
    this._savePending = false;
    this._notifyQueue = [];
  }

  _load() {
    if (!fs.existsSync(this.file)) {
      const def = [
        {
          url: "http://customer-resi_bbc4dfa6-cc-dz:0C7gX_ked_LY@pr.oxylabs.io:7777",
          active: true,
          fail_count: 0,
          cooldown_until: 0,
          added_at: new Date().toISOString(),
          label: "Oxylabs DZ",
        },
      ];
      fs.writeFileSync(this.file, JSON.stringify(def, null, 2));
      return def;
    }
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf-8"));
      if (!Array.isArray(data)) return [];
      return data
        .filter((p) => p && typeof p === "object" && p.url)
        .map((p) => ({
          active: true,
          fail_count: 0,
          cooldown_until: 0,
          added_at: new Date().toISOString(),
          label: "",
          ...p,
        }));
    } catch (e) {
      console.error("load proxies:", e.message);
      return [];
    }
  }

  _save() {
    try {
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.proxies, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error("save proxies:", e.message);
    }
  }

  list() {
    return this.proxies.map((p) => ({ ...p }));
  }

  add(url, label = "") {
    url = (url || "").trim();
    if (!url) return [false, "empty"];
    if (!/^(https?|socks5):\/\//i.test(url)) return [false, "invalid_scheme"];
    if (this.proxies.some((p) => p.url === url)) return [false, "exists"];
    this.proxies.push({
      url,
      label: label || `proxy_${this.proxies.length + 1}`,
      active: true,
      fail_count: 0,
      cooldown_until: 0,
      added_at: new Date().toISOString(),
    });
    this._save();
    return [true, "ok"];
  }

  remove(index) {
    if (index < 0 || index >= this.proxies.length) return false;
    this.proxies.splice(index, 1);
    this._save();
    return true;
  }

  toggle(index) {
    if (index < 0 || index >= this.proxies.length) return null;
    const p = this.proxies[index];
    p.active = !p.active;
    p.cooldown_until = 0;
    p.fail_count = 0;
    this._save();
    return p.active;
  }

  available() {
    const now = Date.now() / 1000;
    return this.proxies.filter((p) => p.active && (p.cooldown_until || 0) < now).map((p) => ({ ...p }));
  }

  hasAnyAvailable() {
    return this.available().length > 0;
  }

  markSuccess(url) {
    const p = this.proxies.find((x) => x.url === url);
    if (p && p.fail_count !== 0) {
      p.fail_count = 0;
      this._save();
    }
  }

  markFail(url, threshold = 3, cooldownSeconds = 600) {
    const p = this.proxies.find((x) => x.url === url);
    if (!p) return [false, ""];
    p.fail_count = (p.fail_count || 0) + 1;
    if (p.fail_count >= threshold) {
      p.cooldown_until = Date.now() / 1000 + cooldownSeconds;
      p.fail_count = 0;
      this._save();
      const short = this._short(url);
      return [true, `⚠️ البروكسي \`${short}\` فشل ${threshold} مرات — تعطيل مؤقت (${Math.floor(cooldownSeconds / 60)} دقيقة)`];
    }
    this._save();
    return [false, ""];
  }

  _short(url) {
    const m = url.match(/^(?:https?|socks5):\/\/(?:[^@]+@)?(.+)$/);
    return m ? m[1] : url.slice(0, 40);
  }

  short(p) {
    return this._short(p.url || "");
  }

  summary() {
    const now = Date.now() / 1000;
    const total = this.proxies.length;
    const active = this.proxies.filter((p) => p.active).length;
    const available = this.proxies.filter((p) => p.active && (p.cooldown_until || 0) < now).length;
    const in_cooldown = this.proxies.filter((p) => p.active && (p.cooldown_until || 0) >= now).length;
    return { total, active, available, in_cooldown };
  }
}

const proxyMgr = new ProxyManager();

// ════════════════════════════════════════════════════════════
// 📡 إشعار الأدمن (Queue)
// ════════════════════════════════════════════════════════════
let botInstance = null;

function notifyAdmin(text) {
  if (!botInstance) return;
  botInstance.api
    .sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" })
    .catch(() => botInstance.api.sendMessage(ADMIN_ID, text).catch((e) => console.error("admin notify:", e.message)));
}

function checkExhaustedAndNotify() {
  if (proxyMgr.hasAnyAvailable()) {
    proxyMgr._notifiedExhausted = false;
    return;
  }
  const now = Date.now() / 1000;
  if (now - proxyMgr._lastNotifiedAt < 300) return;
  proxyMgr._lastNotifiedAt = now;
  const s = proxyMgr.summary();
  notifyAdmin(
    "🚨 *تنبيه عاجل — نفدت البروكسيات!*\n" +
      "━━━━━━━━━━━━━━━━━━━━━━\n" +
      `📦 الإجمالي: *${s.total}*\n` +
      `✅ النشطة: *${s.active}*\n` +
      `🕒 راحة: *${s.in_cooldown}*\n\n` +
      "🔧 أضف بروكسي: `/addproxy <url>`"
  );
}

// ════════════════════════════════════════════════════════════
// 🌐 HTTP Clients
// ════════════════════════════════════════════════════════════
const _httpClients = new Map();

function buildDispatcher(proxyUrl) {
  if (!proxyUrl) {
    return new Agent({
      connections: 200,
      pipelining: 1,
      keepAliveTimeout: 60000,
      keepAliveMaxTimeout: 120000,
    });
  }
  if (proxyUrl.startsWith("socks")) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new ProxyAgent({ uri: proxyUrl, connections: 100, pipelining: 1 });
}

function getDispatcher(proxyUrl) {
  const key = proxyUrl || "__direct__";
  if (_httpClients.has(key)) return _httpClients.get(key);
  const dispatcher = buildDispatcher(proxyUrl);
  _httpClients.set(key, dispatcher);
  return dispatcher;
}

async function closeAllClients() {
  for (const d of _httpClients.values()) {
    try {
      await d.close();
    } catch (_) {}
  }
  _httpClients.clear();
}

// ════════════════════════════════════════════════════════════
// 🔐 OTP Sticky Session
// ════════════════════════════════════════════════════════════
async function openOtpSession(uid) {
  const available = proxyMgr.available();
  if (available.length === 0) {
    checkExhaustedAndNotify();
    return null;
  }
  for (const p of available.slice(0, 3)) {
    const baseUrl = p.url;
    const sessionId = generateSessionId();
    const stickyUrl = makeStickyProxy(baseUrl, sessionId);
    try {
      const dispatcher = buildDispatcher(stickyUrl);
      console.log(
        `🔒 OTP session opened uid=${uid} proxy=${proxyMgr._short(stickyUrl)} sessid=${sessionId}`
      );
      return { dispatcher, proxyUrl: stickyUrl, baseUrl, sessionId };
    } catch (e) {
      console.warn(`⚠️ فشل فتح جلسة OTP: ${e.message}`);
    }
  }
  return null;
}

async function closeOtpSession(session) {
  if (!session || !session.dispatcher) return;
  try {
    await session.dispatcher.close();
    console.log(`🔓 OTP session closed (sessid=${session.sessionId})`);
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════
// 🔁 طلبات HTTP عامة
// ════════════════════════════════════════════════════════════
async function asyncRequestViaProxy(method, url, options = {}, retriesPerProxy = 1) {
  const available = proxyMgr.available();
  if (available.length === 0) {
    checkExhaustedAndNotify();
    return null;
  }

  for (const p of available) {
    const purl = p.url;
    const dispatcher = getDispatcher(purl);
    for (let attempt = 0; attempt < retriesPerProxy; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          dispatcher,
          headers: options.headers || {},
          body: options.body,
          signal: AbortSignal.timeout(options.timeout || 30000),
          redirect: "follow",
        });
        proxyMgr.markSuccess(purl);
        return res;
      } catch (e) {
        console.warn(`⚠️ بروكسي ${proxyMgr._short(purl)}: ${e.name}`);
        const [cooled, msg] = proxyMgr.markFail(purl);
        if (cooled) notifyAdmin(`${msg}\n🧮 المتاح: *${proxyMgr.summary().available}*`);
        break;
      }
    }
  }
  checkExhaustedAndNotify();
  return null;
}

async function testOneProxy(purl, timeoutMs = 15000) {
  const t0 = Date.now();
  try {
    const dispatcher = getDispatcher(purl);
    const res = await fetch("https://ip.oxylabs.io/location", {
      dispatcher,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latency = Date.now() - t0;
    const txt = await res.text();
    if (res.status === 200) return [true, latency, txt.slice(0, 100)];
    return [false, latency, `HTTP ${res.status}`];
  } catch (e) {
    return [false, Date.now() - t0, e.name || "Error"];
  }
}

// ════════════════════════════════════════════════════════════
// 💾 بيانات البوت (Debounced)
// ════════════════════════════════════════════════════════════
const store = new DebouncedStore(DATA_FILE, { users: {}, stats: { users: 0, activations: 0 } });
if (!store.data.users) store.data.users = {};
if (!store.data.stats) store.data.stats = { users: 0, activations: 0 };

const _userLocks = new Map();
function getUserLock(uid) {
  const key = String(uid);
  if (!_userLocks.has(key)) _userLocks.set(key, Promise.resolve());
  return key;
}

async function withUserLock(uid, fn) {
  const key = String(uid);
  const prev = _userLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  _userLocks.set(key, next);
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

function getUser(uid) {
  const key = String(uid);
  const u = store.data.users[key];
  return u && typeof u === "object" ? { ...u } : {};
}

function migrateUser(u) {
  if (!u || typeof u !== "object") return { accounts: [], active: 0 };
  if (!u.accounts) {
    if (u.phone && u.access_token) {
      u.accounts = [
        {
          phone: u.phone,
          access_token: u.access_token,
          refresh_token: u.refresh_token || null,
          token_expiry: u.token_expiry || null,
          label: "رقم 1",
        },
      ];
      u.active = 0;
    } else {
      u.accounts = [];
      u.active = 0;
    }
  }
  if (u.active === undefined) u.active = 0;
  return u;
}

function saveUser(uid, patch) {
  const key = String(uid);
  if (!store.data.users[key] || typeof store.data.users[key] !== "object") {
    store.data.users[key] = {};
    store.data.stats.users = (store.data.stats.users || 0) + 1;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null) store.data.users[key][k] = v;
  }
  store.save();
  return { ...store.data.users[key] };
}

function deleteUser(uid) {
  delete store.data.users[String(uid)];
  store.save();
}

function getAccounts(uid) {
  return migrateUser(getUser(uid)).accounts || [];
}
function getActiveIndex(uid) {
  const u = migrateUser(getUser(uid));
  const accs = u.accounts || [];
  const idx = u.active || 0;
  if (!accs.length) return 0;
  return idx >= 0 && idx < accs.length ? idx : 0;
}
function getActiveAccount(uid) {
  const accs = getAccounts(uid);
  if (!accs.length) return null;
  return accs[getActiveIndex(uid)];
}
function addAccount(uid, msisdn, token, refreshToken, expiresIn = 3600) {
  const u = migrateUser(getUser(uid));
  const accs = u.accounts || [];
  if (accs.some((a) => a.phone === msisdn)) return [false, "exists"];
  if (accs.length >= MAX_ACCOUNTS) return [false, "limit"];
  const exp = new Date(Date.now() + expiresIn * 1000).toISOString();
  accs.push({
    phone: msisdn,
    access_token: token,
    refresh_token: refreshToken || null,
    token_expiry: exp,
    label: `رقم ${accs.length + 1}`,
    last_login: new Date().toISOString(),
  });
  saveUser(uid, {
    accounts: accs,
    active: accs.length - 1,
    login_count: (u.login_count || 0) + 1,
    last_login: new Date().toISOString(),
  });
  return [true, "ok"];
}
function switchAccount(uid, idx) {
  const u = migrateUser(getUser(uid));
  if (idx < 0 || idx >= (u.accounts || []).length) return false;
  saveUser(uid, { active: idx });
  return true;
}
function removeAccount(uid, idx) {
  const u = migrateUser(getUser(uid));
  const accs = u.accounts || [];
  if (idx < 0 || idx >= accs.length) return false;
  accs.splice(idx, 1);
  accs.forEach((a, i) => (a.label = `رقم ${i + 1}`));
  saveUser(uid, { accounts: accs, active: 0 });
  return true;
}
function updateActiveAccount(uid, patch) {
  const u = migrateUser(getUser(uid));
  const accs = u.accounts || [];
  if (!accs.length) return;
  let idx = u.active || 0;
  if (idx >= accs.length) idx = 0;
  Object.assign(accs[idx], patch);
  saveUser(uid, { accounts: accs });
}

// ════════════════════════════════════════════════════════════
// 🛠️ Helpers
// ════════════════════════════════════════════════════════════
function fmtPhone(p) {
  p = (p || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "213" + p.slice(1);
  else if (!p.startsWith("213")) p = "213" + p;
  return p;
}
function maskPhone(m) {
  if (!m) return "—";
  let s = String(m).trim();
  if (s.startsWith("213") && s.length === 12) s = "0" + s.slice(3);
  return s.length >= 8 ? s.slice(0, 2) + "xxxxxxx" + s.slice(-2) : s;
}
function fmtDuration(seconds) {
  seconds = Math.floor(seconds);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} يوم`);
  if (h) parts.push(`${h} ساعة`);
  if (m && !d) parts.push(`${m} دقيقة`);
  return parts.length ? parts.join(" و ") : "أقل من دقيقة";
}

// ════════════════════════════════════════════════════════════
// 🔑 إدارة التوكن
// ════════════════════════════════════════════════════════════
async function refreshTokenSilent(uid) {
  const acc = getActiveAccount(uid);
  if (!acc || !acc.refresh_token) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: acc.refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  }).toString();
  const r = await asyncRequestViaProxy(
    "POST",
    `${BASE_URL}/oauth2/token`,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
    2
  );
  if (r && r.status === 200) {
    try {
      const d = await r.json();
      const exp = new Date(Date.now() + (d.expires_in || 3600) * 1000).toISOString();
      updateActiveAccount(uid, {
        access_token: d.access_token,
        refresh_token: d.refresh_token || acc.refresh_token,
        token_expiry: exp,
        last_refresh: new Date().toISOString(),
      });
      return d.access_token;
    } catch (e) {
      console.error("refresh parse:", e.message);
    }
  }
  return null;
}

function tokenRemaining(uid) {
  const acc = getActiveAccount(uid);
  if (!acc || !acc.token_expiry) return 0;
  try {
    return (new Date(acc.token_expiry).getTime() - Date.now()) / 1000;
  } catch (_) {
    return 0;
  }
}
async function getToken(uid) {
  const acc = getActiveAccount(uid);
  if (!acc || !acc.access_token) return null;
  if (tokenRemaining(uid) < 300) return await refreshTokenSilent(uid);
  return acc.access_token;
}
async function getHeaders(uid) {
  const t = await getToken(uid);
  if (!t) return null;
  return {
    Authorization: `Bearer ${t}`,
    "User-Agent": "MobileApp/3.0.7",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}
function hasSession(uid) {
  const acc = getActiveAccount(uid);
  return !!(acc && acc.access_token && acc.phone);
}
function findSessionByPhone(phone, strictUid = null) {
  phone = fmtPhone(phone);
  for (const uidStr of Object.keys(store.data.users)) {
    if (strictUid !== null && uidStr !== String(strictUid)) continue;
    const u = getUser(uidStr);
    for (const acc of migrateUser(u).accounts || []) {
      if (fmtPhone(acc.phone || "") === phone) return [uidStr, acc];
    }
  }
  return [null, null];
}

// ════════════════════════════════════════════════════════════
// 🎁 الجائزة الأسبوعية
// ════════════════════════════════════════════════════════════
function weeklyRewardRemaining(uid) {
  const acc = getActiveAccount(uid);
  if (!acc || !acc.weekly_reward_activated_at) return [null, null];
  const lastDt = new Date(acc.weekly_reward_activated_at);
  const remaining = WEEKLY_REWARD_COOLDOWN_SECONDS - (Date.now() - lastDt.getTime()) / 1000;
  return remaining <= 0 ? [null, lastDt] : [remaining, lastDt];
}
function markWeeklyRewardActivated(uid) {
  const now = new Date();
  updateActiveAccount(uid, {
    weekly_reward_activated_at: now.toISOString(),
    weekly_reward_activated_at_str: now.toISOString().replace("T", " ").slice(0, 19),
  });
}
function weeklyRewardStatusText(uid) {
  const [remaining, lastDt] = weeklyRewardRemaining(uid);
  if (remaining === null) return lastDt ? "✅ متاحة الآن" : "✅ متاحة (جديدة)";
  return `⏳ متبقٍ ${fmtDuration(remaining)}`;
}

// ════════════════════════════════════════════════════════════
// 🎨 لوحات المفاتيح
// ════════════════════════════════════════════════════════════
function mainMenuKb(uid) {
  const logged = hasSession(uid);
  const accounts = getAccounts(uid);
  let status;
  if (logged) {
    const acc = getActiveAccount(uid);
    status = `📱 ${maskPhone(acc.phone)}`;
    if (accounts.length > 1) status += ` (${getActiveIndex(uid) + 1}/${accounts.length})`;
    status += tokenRemaining(uid) > 0 ? " — ✅" : " — 🔄";
  } else {
    status = "⚠️ غير مسجل";
  }

  const kb = new InlineKeyboard();
  if (!logged) {
    kb.text("🔑 تسجيل الدخول", "login").row();
  } else {
    const rewardStatus = weeklyRewardStatusText(uid);
    kb.text("💰 الرصيد والاستهلاك", "data_balance").row();
    kb.text("⚡ تفعيل 6GB (24 ساعة)", "activate_w6gb").row();
    kb.text(`🎁 الجائزة الأسبوعية 2GB: ${rewardStatus}`, "weekly_reward_info").row();
    if (accounts.length < MAX_ACCOUNTS) kb.text("➕ إضافة رقم", "login_new").row();
    if (accounts.length > 1) {
      kb.text("🔄 تبديل الرقم", "switch_menu").text("🗑️ حذف رقم", "delete_menu").row();
    }
    kb.text("🚪 خروج", "logout").row();
  }
  if (uid == ADMIN_ID) kb.text("⚙️ لوحة التحكم", "admin_panel").row();
  kb.text("❌ إغلاق", "close");
  return [kb, status];
}

function backKb() {
  return new InlineKeyboard().text("🔙 رجوع", "back_main");
}
function switchKb(uid) {
  const accounts = getAccounts(uid);
  const activeIdx = getActiveIndex(uid);
  const kb = new InlineKeyboard();
  accounts.forEach((acc, i) => {
    const mark = i === activeIdx ? "✅ " : "";
    kb.text(`${mark}${acc.label || `رقم ${i + 1}`} — ${maskPhone(acc.phone)}`, `switch_${i}`).row();
  });
  kb.text("🔙 رجوع", "back_main");
  return kb;
}
function deleteKb(uid) {
  const accounts = getAccounts(uid);
  const kb = new InlineKeyboard();
  accounts.forEach((acc, i) => {
    kb.text(`❌ ${acc.label || `رقم ${i + 1}`} — ${maskPhone(acc.phone)}`, `delete_${i}`).row();
  });
  kb.text("🔙 رجوع", "back_main");
  return kb;
}
function proxiesAdminKb() {
  return new InlineKeyboard()
    .text("📋 عرض القائمة", "proxy_list").row()
    .text("➕ إضافة بروكسي", "proxy_add").row()
    .text("🗑️ حذف بروكسي", "proxy_del_menu").row()
    .text("🔬 اختبار الكل", "proxy_test_all").row()
    .text("🔙 رجوع", "admin_panel");
}

// ════════════════════════════════════════════════════════════
// 📊 تنسيق بيانات الرصيد
// ════════════════════════════════════════════════════════════
function formatData(remaining, total, unit) {
  let rem, tot;
  if (unit === "MB") {
    rem = remaining < 1024 ? `${Math.round(remaining)} MB` : `${(remaining / 1024).toFixed(2)} GB`;
    tot = total < 1024 ? `${Math.round(total)} MB` : `${(total / 1024).toFixed(2)} GB`;
  } else {
    rem = `${remaining} ${unit}`;
    tot = `${total} ${unit}`;
  }
  return [rem, tot];
}
function progressBar(remaining, total, width = 15) {
  if (total <= 0) return [null, 0, "🟢"];
  const pct = (remaining / total) * 100;
  const filled = Math.floor((width * pct) / 100);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const emoji = pct > 50 ? "🟢" : pct > 20 ? "🟡" : "🔴";
  return [bar, pct, emoji];
}

// ════════════════════════════════════════════════════════════
// 🎯 أوامر / الإجراءات
// ════════════════════════════════════════════════════════════
function isAuthorized(uid) {
  return !ALLOWED_USERS.length || ALLOWED_USERS.includes(uid);
}

// ════════════════════════════════════════════════════════════
// 🤖 إنشاء البوت
// ════════════════════════════════════════════════════════════
const bot = new Bot(BOT_TOKEN);
botInstance = bot;

// 🎯 إعداد Runner للمعالجة المتوازية
bot.api.config.use(async (prev, method, payload, signal) => {
  return prev(method, payload, signal);
});

// ─── /start ─────────────────────────────────────────────────
bot.command("start", async (ctx) => {
  if (!isAuthorized(ctx.from.id)) return ctx.reply("⛔ غير مصرح لك باستخدام هذا البوت.");
  const uid = ctx.from.id;
  if (hasSession(uid) && tokenRemaining(uid) < 300) await refreshTokenSilent(uid);
  const [kb, status] = mainMenuKb(uid);
  const text = `🌙 *بوت جيزي — by_moon*\n━━━━━━━━━━━━━━━━━━━━━━\n${mdEscape(status)}\n\nاختر من القائمة:`;
  return ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" });
});

// ════════════════════════════════════════════════════════════
// 🎛️ Session middleware (للمحادثات)
// ════════════════════════════════════════════════════════════
bot.use(session({ initial: () => ({}) }));

// ════════════════════════════════════════════════════════════
// 🔑 تسجيل الدخول
// ════════════════════════════════════════════════════════════
bot.callbackQuery("login", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "WAIT_PHONE";
  await ctx.editMessageText("📱 أدخل رقم جيزي (07xxxxxxxx):\n\n💡 إذا كان الرقم محفوظاً مسبقاً، سيُستأنف تلقائياً بدون OTP");
});

bot.callbackQuery("login_new", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  if (getAccounts(uid).length >= MAX_ACCOUNTS) {
    return ctx.editMessageText(
      `⚠️ وصلت للحد الأقصى (${MAX_ACCOUNTS} أرقام).\nاحذف رقماً أولاً.`,
      { reply_markup: backKb() }
    );
  }
  ctx.session.step = "WAIT_PHONE_NEW";
  await ctx.editMessageText("🆕 أدخل الرقم (07xxxxxxxx):\n\n💡 إذا كان الرقم محفوظاً مسبقاً، ستُستأنف جلسته تلقائياً");
});

// ════════════════════════════════════════════════════════════
// 📥 استقبال الرقم
// ════════════════════════════════════════════════════════════
bot.on("message:text", async (ctx, next) => {
  const uid = ctx.from.id;
  const step = ctx.session.step;
  if (step !== "WAIT_PHONE" && step !== "WAIT_PHONE_NEW") return next();

  const phone = fmtPhone(ctx.message.text.trim());
  if (phone.length !== 12 || !phone.startsWith("213")) {
    return ctx.reply("❌ رقم غير صحيح. حاول مرة أخرى (07xxxxxxxx):");
  }

  // تنظيف جلسة قديمة
  if (ctx.session.otpSession) {
    closeOtpSession(ctx.session.otpSession);
    delete ctx.session.otpSession;
  }
  ctx.session.otpAttempts = 0;

  const existing = getAccounts(uid);
  if (existing.some((a) => fmtPhone(a.phone || "") === phone)) {
    ctx.session.step = undefined;
    return ctx.reply("⚠️ هذا الرقم مضاف مسبقاً!");
  }

  const [foundUid, foundAcc] = findSessionByPhone(phone);
  if (foundAcc && STRICT_SESSION_BINDING && foundUid !== String(uid)) {
    ctx.session.step = undefined;
    return ctx.reply("⛔ هذا الرقم مسجل بالفعل على حساب تلقرام آخر.\n🔐 لأسباب أمنية، لا يمكن استئناف الجلسة من هنا.");
  }

  ctx.session.pendingPhone = phone;

  // استئناف من نفس الحساب
  for (let i = 0; i < existing.length; i++) {
    const acc = existing[i];
    if (fmtPhone(acc.phone || "") === phone) {
      const exp = acc.token_expiry ? new Date(acc.token_expiry).getTime() : 0;
      const rem = (exp - Date.now()) / 1000;
      if (rem < 300 && acc.refresh_token) {
        switchAccount(uid, i);
        await refreshTokenSilent(uid);
      } else {
        switchAccount(uid, i);
      }
      ctx.session.step = undefined;
      await ctx.reply(`✅ *تم استئناف الجلسة!*\n📱 \`${maskPhone(phone)}\``, { parse_mode: "Markdown" });
      const [kb] = mainMenuKb(uid);
      return ctx.reply("اختر من القائمة:", { reply_markup: kb });
    }
  }

  // 🆕 إرسال OTP
  await ctx.reply("📩 جاري إرسال OTP...");
  const session = await openOtpSession(uid);
  if (!session) {
    ctx.session.step = undefined;
    await ctx.reply("❌ لا يوجد بروكسي متاح — أبلغ الأدمن");
    checkExhaustedAndNotify();
    return;
  }

  try {
    const res = await fetch(
      `${BASE_URL}/oauth2/registration?msisdn=${phone}&client_id=${CLIENT_ID}&scope=smsotp`,
      {
        method: "POST",
        dispatcher: session.dispatcher,
        headers: { "Content-Type": "application/json", "User-Agent": "MobileApp/3.0.7" },
        body: JSON.stringify({
          "consent-agreement": [{ "marketing-notifications": false }],
          "is-consent": true,
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    proxyMgr.markSuccess(session.baseUrl);

    if (![200, 201, 202].includes(res.status)) {
      await closeOtpSession(session);
      ctx.session.step = undefined;
      const body = (await res.text()).slice(0, 200);
      return ctx.reply(`❌ فشل الإرسال (${res.status})\n\`${mdEscape(body)}\``, { parse_mode: "Markdown" });
    }
  } catch (e) {
    proxyMgr.markFail(session.baseUrl);
    await closeOtpSession(session);
    ctx.session.step = undefined;
    return ctx.reply("❌ فشل الاتصال بالخادم (ربما نفدت البروكسيات).");
  }

  ctx.session.otpSession = session;
  ctx.session.step = "WAIT_OTP";
  await ctx.reply(
    `✅ تم إرسال OTP إلى \`${phone}\`\n\n📩 أرسل الكود (6 أرقام):`,
    { parse_mode: "Markdown" }
  );
});

// ════════════════════════════════════════════════════════════
// 📥 استقبال OTP
// ════════════════════════════════════════════════════════════
bot.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "WAIT_OTP") return next();
  const uid = ctx.from.id;
  const otp = ctx.message.text.trim();
  const phone = ctx.session.pendingPhone;
  const session = ctx.session.otpSession;

  if (!phone || !session) {
    ctx.session.step = undefined;
    return ctx.reply("❌ حدث خطأ. أعد المحاولة من /start");
  }
  if (!/^\d{6}$/.test(otp)) {
    return ctx.reply("❌ الكود يجب أن يكون 6 أرقام. أعد الإرسال:");
  }

  await ctx.reply("⏳ جاري التحقق...");

  const payload = new URLSearchParams({
    otp,
    mobileNumber: phone,
    grant_type: "mobile",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "djezzyAppV2",
  }).toString();

  let res = null;
  try {
    res = await fetch(`${BASE_URL}/oauth2/token`, {
      method: "POST",
      dispatcher: session.dispatcher,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "MobileApp/3.0.7",
      },
      body: payload,
      signal: AbortSignal.timeout(30000),
    });
    proxyMgr.markSuccess(session.baseUrl);
    console.log(`✅ OTP verify via same session (sessid=${session.sessionId}) → HTTP ${res.status}`);
  } catch (e) {
    console.warn(`⚠️ فشل التحقق عبر الجلسة: ${e.name}`);
    proxyMgr.markFail(session.baseUrl);
    res = null;
  }

  // 🔄 إعادة المحاولة
  if (!res) {
    console.warn("⚠️ إعادة المحاولة عبر جلسة OTP جديدة...");
    await closeOtpSession(session);
    delete ctx.session.otpSession;

    const session2 = await openOtpSession(uid);
    if (session2) {
      try {
        const r2 = await fetch(
          `${BASE_URL}/oauth2/registration?msisdn=${phone}&client_id=${CLIENT_ID}&scope=smsotp`,
          {
            method: "POST",
            dispatcher: session2.dispatcher,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              "consent-agreement": [{ "marketing-notifications": false }],
              "is-consent": true,
            }),
            signal: AbortSignal.timeout(30000),
          }
        );
        if ([200, 201, 202].includes(r2.status)) {
          ctx.session.otpSession = session2;
          ctx.session.otpAttempts = 0;
          return ctx.reply("⚠️ *انقطع الاتصال. تم إرسال OTP جديد.*\n\n📩 إذا وصلك كود جديد، أرسله الآن:", {
            parse_mode: "Markdown",
          });
        } else {
          await closeOtpSession(session2);
        }
      } catch (_) {
        await closeOtpSession(session2);
      }
    }
    ctx.session.step = undefined;
    return ctx.reply(
      "❌ *فشل الاتصال بجيزي*.\n\n🔧 الاحتمالات:\n• جميع البروكسيات معطّلة (تم إبلاغ الأدمن)\n• انقطاع الشبكة\n\n💡 أرسل /start للمحاولة من جديد",
      { parse_mode: "Markdown" }
    );
  }

  const bodyText = await res.text();
  console.log(`OTP response body: ${bodyText.slice(0, 300)}`);

  if (res.status === 200) {
    try {
      const d = JSON.parse(bodyText);
      const [ok, reason] = addAccount(uid, phone, d.access_token, d.refresh_token, d.expires_in || 3600);
      await closeOtpSession(session);
      ctx.session.otpSession = undefined;
      ctx.session.otpAttempts = undefined;
      ctx.session.pendingPhone = undefined;
      ctx.session.step = undefined;

      if (!ok) {
        const msg = reason === "exists" ? "⚠️ هذا الرقم مضاف مسبقاً!" : "⚠️ وصلت للحد الأقصى!";
        return ctx.reply(msg);
      }

      await ctx.reply(`✅ *تم تسجيل الدخول بنجاح!*\n\n📱 \`${maskPhone(phone)}\``, { parse_mode: "Markdown" });
      const [kb] = mainMenuKb(uid);
      return ctx.reply("اختر من القائمة:", { reply_markup: kb });
    } catch (e) {
      console.error("otp save error:", e.message);
      return ctx.reply(`❌ خطأ: ${e.message}`);
    }
  }

  // ⚠️ معالجة الأخطاء
  let errCode = "";
  let errDesc = bodyText.toLowerCase();
  try {
    const j = JSON.parse(bodyText);
    errCode = (j.error || "").toLowerCase();
    errDesc = (j.error_description || j.message || "").toLowerCase();
  } catch (_) {}

  const isExpired = errCode.includes("expired") || errDesc.includes("expired") || errDesc.includes("expiré");
  const isWrong = errCode.includes("invalid") || errDesc.includes("wrong") || errDesc.includes("incorrect");

  if (isExpired) {
    const attempts = (ctx.session.otpAttempts || 0) + 1;
    ctx.session.otpAttempts = attempts;
    if (attempts <= 1) {
      try {
        const r2 = await fetch(
          `${BASE_URL}/oauth2/registration?msisdn=${phone}&client_id=${CLIENT_ID}&scope=smsotp`,
          {
            method: "POST",
            dispatcher: session.dispatcher,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              "consent-agreement": [{ "marketing-notifications": false }],
              "is-consent": true,
            }),
            signal: AbortSignal.timeout(30000),
          }
        );
        if ([200, 201, 202].includes(r2.status)) {
          return ctx.reply("⏱ *انتهت صلاحية الكود.*\n\n📩 تم إرسال كود جديد — أرسله الآن:", {
            parse_mode: "Markdown",
          });
        }
      } catch (_) {}
    }
    await closeOtpSession(session);
    ctx.session.otpSession = undefined;
    ctx.session.otpAttempts = undefined;
    ctx.session.pendingPhone = undefined;
    ctx.session.step = undefined;
    return ctx.reply(
      "⏱ *انتهت صلاحية الكود.*\n\n🔁 يرجى بدء التسجيل من جديد:\nأرسل /start ثم أدخل رقمك مرة أخرى.",
      { parse_mode: "Markdown" }
    );
  }

  if (isWrong) {
    return ctx.reply("❌ *كود خاطئ.*\n\nأرسل الكود الصحيح (نفس الجلسة):", { parse_mode: "Markdown" });
  }

  // ❌ خطأ غير معروف
  await closeOtpSession(session);
  ctx.session.otpSession = undefined;
  ctx.session.otpAttempts = undefined;
  ctx.session.pendingPhone = undefined;
  ctx.session.step = undefined;
  let errText = bodyText.slice(0, 200);
  try {
    const j = JSON.parse(bodyText);
    errText = j.error_description || j.message || errText;
  } catch (_) {}
  return ctx.reply(`❌ فشل (${res.status})\n\`${mdEscape(String(errText))}\``, { parse_mode: "Markdown" });
});

// ════════════════════════════════════════════════════════════
// 💰 الرصيد والاستهلاك
// ════════════════════════════════════════════════════════════
bot.callbackQuery("data_balance", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  if (!hasSession(uid)) return ctx.editMessageText("⚠️ سجل الدخول أولاً", { reply_markup: backKb() });

  await ctx.editMessageText("⏳ جاري جلب الرصيد والاستهلاك...");
  const h = await getHeaders(uid);
  if (!h) return ctx.editMessageText("❌ انتهت الجلسة — أعد تسجيل الدخول", { reply_markup: backKb() });

  const phone = getActiveAccount(uid).phone;
  const res = await asyncRequestViaProxy(
    "GET",
    `${BASE_URL}/api/v1/subscribers/connected-products-balances/${phone}`,
    { headers: h },
    2
  );

  if (!res || res.status !== 200) {
    const err = res ? (await res.text()).slice(0, 200) : "فشل الاتصال (ربما نفدت البروكسيات)";
    return ctx.editMessageText(`❌ فشل جلب الرصيد\n\`${mdEscape(err)}\``, {
      reply_markup: backKb(),
      parse_mode: "Markdown",
    });
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return ctx.editMessageText(`❌ خطأ JSON: ${e.message}`, { reply_markup: backKb() });
  }

  const d = data.data || data;
  const mainBalance = d.mainBalance || 0;
  const lines = [
    "💰 *الرصيد والاستهلاك*",
    "━━━━━━━━━━━━━━━━━━━━━━",
    `📱 \`${maskPhone(phone)}\``,
    `💵 *الرصيد:* \`${mainBalance} DA\`\n`,
  ];

  const products = d.products || d.connectedProducts || [];
  if (!products.length) {
    lines.push("📭 لا توجد باقات نشطة");
    return ctx.editMessageText(lines.join("\n"), { reply_markup: backKb(), parse_mode: "Markdown" });
  }

  for (const p of products) {
    const commercial = p.commercialName;
    let name;
    if (commercial && typeof commercial === "object") {
      name = commercial.ar || commercial.en || commercial.fr || p.code || "باقة";
    } else {
      name = commercial ? String(commercial) : p.code || "باقة";
    }

    const expiry = p.expiryAt || "";
    lines.push(`\n🔹 *${mdEscape(name)}*`);
    if (expiry) lines.push(`📅 ينتهي: \`${expiry}\``);

    const balances = p.balances || [];
    if (!balances.length) {
      lines.push("ℹ️ لا توجد بيانات استهلاك");
      continue;
    }
    for (const b of balances) {
      const usageType = (b.usageType || "").toUpperCase();
      const unit = b.usageUnit || "";
      const remaining = b.remaining || 0;
      const total = b.totalAmount || 0;
      const bExpiry = b.expiryAt || expiry;

      if (usageType === "DATA") {
        const [rem, tot] = formatData(remaining, total, unit);
        if (total > 0) {
          const [bar, pct, emoji] = progressBar(remaining, total);
          lines.push(`💾 الإنترنت: *${rem}* / ${tot}`);
          lines.push(`\`[${bar}]\` ${emoji} ${pct.toFixed(1)}%`);
        } else {
          lines.push(`💾 الإنترنت: *${rem}*`);
        }
        if (bExpiry) lines.push(`⏰ \`${bExpiry}\``);
      } else if (usageType === "VOICE" || usageType === "MINUTES") {
        lines.push(`📞 دقائق: *${remaining}* / ${total} ${unit}`);
      } else if (usageType === "SMS") {
        lines.push(`✉️ رسائل: *${remaining}* / ${total}`);
      } else {
        let bName = b.name;
        if (bName && typeof bName === "object") bName = bName.ar || bName.en || bName.fr || "";
        const label = bName || usageType || "رصيد";
        lines.push(`📊 ${mdEscape(label)}: *${remaining}* ${unit}`);
      }
    }
  }
  lines.push("\n━━━━━━━━━━━━━━━━━━━━━━");
  const text = safeMd(lines.join("\n"));

  try {
    await ctx.editMessageText(text, { reply_markup: backKb(), parse_mode: "Markdown" });
  } catch (_) {
    const plain = text.replace(/[*_`\[\]]/g, "");
    await ctx.editMessageText(plain, { reply_markup: backKb() });
  }
});

// ════════════════════════════════════════════════════════════
// 🎁 الجائزة الأسبوعية
// ════════════════════════════════════════════════════════════
bot.callbackQuery("weekly_reward_info", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  if (!hasSession(uid)) return ctx.editMessageText("⚠️ سجل الدخول أولاً", { reply_markup: backKb() });

  const [remaining, lastDt] = weeklyRewardRemaining(uid);
  const lastStr = lastDt ? lastDt.toISOString().replace("T", " ").slice(0, 19) : "لم تُفعَّل بعد";
  const lines = [
    "🎁 *الجائزة الأسبوعية 2GB*",
    "━━━━━━━━━━━━━━━━━━━━━━",
    `📅 آخر تفعيل: \`${lastStr}\``,
    `⏱ المدة القياسية: *7 أيام*`,
    "",
  ];
  const kb = new InlineKeyboard();
  if (remaining === null) {
    lines.push("✅ *متاحة الآن!*");
    kb.text("🎁 تفعيل الجائزة الآن", `activate_${WEEKLY_REWARD_KEY}`).row();
    kb.text("🔙 رجوع", "back_main");
  } else {
    const nextDt = new Date(lastDt.getTime() + WEEKLY_REWARD_COOLDOWN_SECONDS * 1000);
    lines.push("⏳ *لم يحن وقت التفعيل بعد*");
    lines.push("");
    lines.push(`⏰ المتبقي: *${fmtDuration(remaining)}*`);
    lines.push(`🗓 يمكن التفعيل: \`${nextDt.toISOString().replace("T", " ").slice(0, 19)}\``);
    kb.text("🔄 تحديث", "weekly_reward_info").row();
    kb.text("🔙 رجوع", "back_main");
  }
  await ctx.editMessageText(lines.join("\n"), { reply_markup: kb, parse_mode: "Markdown" });
});

// ════════════════════════════════════════════════════════════
// ⚡ تفعيل عرض
// ════════════════════════════════════════════════════════════
bot.callbackQuery(/^activate_/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  const key = ctx.match ? ctx.match[0].replace("activate_", "") : ctx.callbackQuery.data.replace("activate_", "");
  const pkg = OFFER_DATA[key];
  if (!pkg) return ctx.editMessageText("❌ عرض غير موجود", { reply_markup: backKb() });
  if (!hasSession(uid)) return ctx.editMessageText("⚠️ سجل الدخول أولاً", { reply_markup: backKb() });

  if (key === WEEKLY_REWARD_KEY) {
    const [remaining, lastDt] = weeklyRewardRemaining(uid);
    if (remaining !== null && remaining > 0) {
      const lastStr = lastDt ? lastDt.toISOString().replace("T", " ").slice(0, 19) : "?";
      const nextDt = new Date(lastDt.getTime() + WEEKLY_REWARD_COOLDOWN_SECONDS * 1000);
      const text =
        "🎁 *الجائزة الأسبوعية 2GB*\n" +
        "━━━━━━━━━━━━━━━━━━━━━━\n" +
        "⏳ *لم يحن وقت التفعيل بعد*\n\n" +
        `📅 آخر تفعيل: \`${lastStr}\`\n` +
        `⏰ المتبقي: *${fmtDuration(remaining)}*\n` +
        `🗓 يمكن التفعيل: \`${nextDt.toISOString().replace("T", " ").slice(0, 19)}\``;
      return ctx.editMessageText(text, { reply_markup: backKb(), parse_mode: "Markdown" });
    }
  }

  await ctx.editMessageText(`⏳ جاري تفعيل: *${pkg.name}*...`, { parse_mode: "Markdown" });
  const h = await getHeaders(uid);
  if (!h) return ctx.editMessageText("❌ انتهت الجلسة", { reply_markup: backKb() });

  const phone = getActiveAccount(uid).phone;
  const url = `${BASE_URL}/api/v1/services/walk/activate-reward/${phone}`;
  const res = await asyncRequestViaProxy(
    "POST",
    url,
    {
      headers: h,
      body: JSON.stringify({ packageCode: pkg.code }),
    },
    2
  );

  if (!res) return ctx.editMessageText("❌ فشل الاتصال (ربما نفدت البروكسيات)", { reply_markup: backKb() });

  if ([200, 201, 202].includes(res.status)) {
    let extra = "";
    if (key === WEEKLY_REWARD_KEY) {
      markWeeklyRewardActivated(uid);
      const now = new Date();
      const nextDt = new Date(now.getTime() + WEEKLY_REWARD_COOLDOWN_SECONDS * 1000);
      extra =
        "\n\n━━━━━━━━━━━━━━━━━━━━━━\n" +
        `📅 تاريخ التفعيل: \`${now.toISOString().replace("T", " ").slice(0, 19)}\`\n` +
        `🗓 التفعيل القادم: \`${nextDt.toISOString().replace("T", " ").slice(0, 19)}\``;
    }
    await ctx.editMessageText(`✅ *تم التفعيل بنجاح!*\n\n${pkg.name}${extra}`, {
      reply_markup: backKb(),
      parse_mode: "Markdown",
    });
  } else {
    let msg = (await res.text()).slice(0, 200);
    try {
      const j = JSON.parse(msg);
      const m = j.message || {};
      msg = typeof m === "object" ? m.ar || m.en || JSON.stringify(m) : m;
    } catch (_) {}
    if (["already", "deja", "déjà", "مسبق", "used"].some((k) => String(msg).toLowerCase().includes(k))) {
      msg = "⚠️ العرض مسجل مسبقاً على هذا الرقم.";
    }
    await ctx.editMessageText(`❌ فشل التفعيل (${res.status})\n\`${mdEscape(msg)}\``, {
      reply_markup: backKb(),
      parse_mode: "Markdown",
    });
  }
});

// ════════════════════════════════════════════════════════════
// 🔄 تبديل/حذف حساب
// ════════════════════════════════════════════════════════════
bot.callbackQuery("switch_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  if (!getAccounts(uid).length) return ctx.editMessageText("⚠️ لا يوجد أرقام محفوظة", { reply_markup: backKb() });
  await ctx.editMessageText("🔄 *اختر الرقم النشط:*", { reply_markup: switchKb(uid), parse_mode: "Markdown" });
});

bot.callbackQuery(/^switch_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  const idx = parseInt(ctx.callbackQuery.data.split("_").pop(), 10);
  if (switchAccount(uid, idx)) {
    const [kb, status] = mainMenuKb(uid);
    await ctx.editMessageText(`✅ *تم التبديل*\n${mdEscape(status)}`, { reply_markup: kb, parse_mode: "Markdown" });
  } else {
    await ctx.answerCallbackQuery({ text: "❌ فشل", show_alert: true });
  }
});

bot.callbackQuery("delete_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  if (!getAccounts(uid).length) return ctx.editMessageText("⚠️ لا يوجد أرقام", { reply_markup: backKb() });
  await ctx.editMessageText("🗑️ *اختر الرقم لحذفه:*", { reply_markup: deleteKb(uid), parse_mode: "Markdown" });
});

bot.callbackQuery(/^delete_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  const idx = parseInt(ctx.callbackQuery.data.split("_").pop(), 10);
  const accounts = getAccounts(uid);
  if (idx < 0 || idx >= accounts.length) return ctx.answerCallbackQuery({ text: "❌ خطأ", show_alert: true });
  const acc = accounts[idx];
  const kb = new InlineKeyboard()
    .text("✅ نعم، احذف", `confirm_del_${idx}`)
    .row()
    .text("🔙 رجوع", "delete_menu");
  await ctx.editMessageText(`⚠️ *هل أنت متأكد من حذف:*\n📱 \`${maskPhone(acc.phone)}\``, {
    reply_markup: kb,
    parse_mode: "Markdown",
  });
});

bot.callbackQuery(/^confirm_del_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  const idx = parseInt(ctx.callbackQuery.data.split("_").pop(), 10);
  if (removeAccount(uid, idx)) {
    if (!getAccounts(uid).length) {
      return ctx.editMessageText("📱 تم حذف جميع الأرقام.\nاستخدم /start للتسجيل من جديد.");
    }
    const [kb, status] = mainMenuKb(uid);
    await ctx.editMessageText(`✅ تم الحذف\n${mdEscape(status)}`, { reply_markup: kb, parse_mode: "Markdown" });
  } else {
    await ctx.answerCallbackQuery({ text: "❌ فشل", show_alert: true });
  }
});

// ════════════════════════════════════════════════════════════
// 🚪 خروج / إغلاق / رجوع
// ════════════════════════════════════════════════════════════
bot.callbackQuery("back_main", async (ctx) => {
  await ctx.answerCallbackQuery();
  const uid = ctx.from.id;
  if (hasSession(uid) && tokenRemaining(uid) < 300) await refreshTokenSilent(uid);
  const [kb, status] = mainMenuKb(uid);
  const text = `🌙 *بوت جيزي — by_moon*\n━━━━━━━━━━━━━━━━━━━━━━\n${mdEscape(status)}\n\nاختر من القائمة:`;
  try {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
  } catch (_) {
    await ctx.reply(text, { reply_markup: kb, parse_mode: "Markdown" });
  }
});

bot.callbackQuery("logout", async (ctx) => {
  await ctx.answerCallbackQuery();
  deleteUser(ctx.from.id);
  await ctx.editMessageText(
    "✅ تم تسجيل الخروج\n\n💡 أرسل /start للعودة",
    { reply_markup: new InlineKeyboard().text("🔑 تسجيل دخول", "login") }
  );
});

bot.callbackQuery("close", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("👋 إلى اللقاء!");
});

// ════════════════════════════════════════════════════════════
// 🌐 إدارة البروكسيات
// ════════════════════════════════════════════════════════════
bot.callbackQuery("admin_proxies", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery({ text: "⛔ غير مصرح", show_alert: true });
  const s = proxyMgr.summary();
  const text =
    "🌐 *إدارة البروكسيات*\n" +
    "━━━━━━━━━━━━━━━━━━━━━━\n" +
    `📦 الإجمالي: *${s.total}*\n` +
    `✅ نشط: *${s.active}*\n` +
    `🟢 متاح الآن: *${s.available}*\n` +
    `🕒 في فترة راحة: *${s.in_cooldown}*\n\n` +
    "استخدم الأزرار أدناه 👇";
  await ctx.editMessageText(text, { reply_markup: proxiesAdminKb(), parse_mode: "Markdown" });
});

bot.callbackQuery("proxy_list", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return;
  const plist = proxyMgr.list();
  if (!plist.length) return ctx.editMessageText("📭 لا توجد بروكسيات. أضف واحداً.", { reply_markup: proxiesAdminKb() });

  const now = Date.now() / 1000;
  const lines = ["🌐 *قائمة البروكسيات*", "━━━━━━━━━━━━━━━━━━━━━━"];
  plist.forEach((p, i) => {
    const short = mdEscape(proxyMgr.short(p));
    const isActive = p.active !== false;
    const cdLeft = Math.max(0, Math.floor((p.cooldown_until || 0) - now));
    let icon, state;
    if (!isActive) {
      icon = "⛔";
      state = "معطّل يدوياً";
    } else if (cdLeft > 0) {
      icon = "🕒";
      state = `راحة ${Math.floor(cdLeft / 60)}د ${cdLeft % 60}ث`;
    } else {
      icon = "✅";
      state = "متاح";
    }
    lines.push(`${i + 1}. ${icon} \`${short}\`\n   └ ${state} | فشل متتالي: ${p.fail_count || 0}`);
  });
  const text = safeMd(lines.join("\n"));

  const kb = new InlineKeyboard();
  plist.slice(0, 10).forEach((p, i) => {
    const icon = !p.active ? "⛔ إعادة تفعيل" : "✅ تعطيل";
    kb.text(`${icon} #${i + 1}`, `proxy_toggle_${i}`).row();
  });
  kb.text("🔙 رجوع", "admin_proxies");

  try {
    await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
  } catch (_) {
    const plain = text.replace(/[*_`\[\]]/g, "");
    await ctx.editMessageText(plain, { reply_markup: kb });
  }
});

bot.callbackQuery(/^proxy_toggle_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return;
  const idx = parseInt(ctx.callbackQuery.data.split("_").pop(), 10);
  const newState = proxyMgr.toggle(idx);
  if (newState === null) return ctx.answerCallbackQuery({ text: "❌ خطأ", show_alert: true });
  await ctx.answerCallbackQuery({ text: newState ? "✅ تم التفعيل" : "⛔ تم التعطيل", show_alert: false });
  // refresh
  const plist = proxyMgr.list();
  const now = Date.now() / 1000;
  const lines = ["🌐 *قائمة البروكسيات*", "━━━━━━━━━━━━━━━━━━━━━━"];
  plist.forEach((p, i) => {
    const short = mdEscape(proxyMgr.short(p));
    const isActive = p.active !== false;
    const cdLeft = Math.max(0, Math.floor((p.cooldown_until || 0) - now));
    let icon, state;
    if (!isActive) {
      icon = "⛔";
      state = "معطّل يدوياً";
    } else if (cdLeft > 0) {
      icon = "🕒";
      state = `راحة ${Math.floor(cdLeft / 60)}د ${cdLeft % 60}ث`;
    } else {
      icon = "✅";
      state = "متاح";
    }
    lines.push(`${i + 1}. ${icon} \`${short}\`\n   └ ${state} | فشل متتالي: ${p.fail_count || 0}`);
  });
  const kb = new InlineKeyboard();
  plist.slice(0, 10).forEach((p, i) => {
    const icon = !p.active ? "⛔ إعادة تفعيل" : "✅ تعطيل";
    kb.text(`${icon} #${i + 1}`, `proxy_toggle_${i}`).row();
  });
  kb.text("🔙 رجوع", "admin_proxies");
  try {
    await ctx.editMessageText(safeMd(lines.join("\n")), { reply_markup: kb, parse_mode: "Markdown" });
  } catch (_) {}
});

bot.callbackQuery("proxy_add", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return;
  ctx.session.step = "WAIT_PROXY_INPUT";
  await ctx.editMessageText(
    "➕ *إضافة بروكسي جديد*\n\n" +
      "يمكنك إرسال أي من الصيغ:\n" +
      "**1)** `http://user:pass@host:port`\n" +
      "**2)** سكربت Python كامل (username/password/country/...)\n" +
      "**3)** سكربت مختصر `username='...' password='...' country='dz'`\n\n" +
      "📩 أرسل البروكسي الآن:",
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().text("🔙 إلغاء", "admin_proxies"),
    }
  );
});

bot.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "WAIT_PROXY_INPUT") return next();
  if (ctx.from.id !== ADMIN_ID) return next();
  ctx.session.step = undefined;
  const raw = ctx.message.text.trim();
  const [url, err] = parseProxyInput(raw);
  if (!url) {
    return ctx.reply(`❌ *تعذّر استخراج البروكسي*\n\nالسبب: \`${mdEscape(err)}\``, {
      parse_mode: "Markdown",
      reply_markup: proxiesAdminKb(),
    });
  }
  const short = mdEscape(proxyMgr._short(url));
  await ctx.reply(`🔬 جاري اختبار البروكسي \`${short}\`...`, { parse_mode: "Markdown" });
  const [ok, latency, info] = await testOneProxy(url);
  if (ok) {
    const [added, reason] = proxyMgr.add(url, "");
    if (!added) {
      const msg = reason === "exists" ? "⚠️ موجود مسبقاً!" : "❌ صيغة غير صحيحة";
      return ctx.reply(msg, { reply_markup: proxiesAdminKb() });
    }
    await ctx.reply(
      `✅ *تم إضافة البروكسي بنجاح!*\n\n🔗 \`${short}\`\n⚡ \`${latency} ms\`\n📍 \`${mdEscape(String(info))}\``,
      { parse_mode: "Markdown", reply_markup: proxiesAdminKb() }
    );
  } else {
    ctx.session.pendingProxy = { url, label: "" };
    await ctx.reply(
      `⚠️ *فشل اختبار البروكسي!*\n\n🔗 \`${short}\`\n❌ \`${mdEscape(String(info))}\`\n⚡ \`${latency} ms\`\n\nهل تريد إضافته رغم ذلك؟`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("✅ أضفه رغم الفشل", "proxy_force_add")
          .row()
          .text("🔙 إلغاء", "admin_proxies"),
      }
    );
  }
});

bot.callbackQuery("proxy_force_add", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return;
  const pending = ctx.session.pendingProxy;
  if (!pending) return ctx.editMessageText("❌ لا يوجد بروكسي معلق", { reply_markup: proxiesAdminKb() });
  const [added] = proxyMgr.add(pending.url, pending.label);
  if (added) {
    await ctx.editMessageText(`✅ *تم الإضافة (رغم فشل الاختبار)*\n\n🔗 \`${mdEscape(proxyMgr._short(pending.url))}\``, {
      parse_mode: "Markdown",
      reply_markup: proxiesAdminKb(),
    });
  } else {
    await ctx.editMessageText(`❌ فشل الإضافة`, { reply_markup: proxiesAdminKb() });
  }
  delete ctx.session.pendingProxy;
});

bot.callbackQuery("proxy_del_menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return;
  const plist = proxyMgr.list();
  if (!plist.length) return ctx.editMessageText("📭 لا توجد بروكسيات", { reply_markup: proxiesAdminKb() });
  const kb = new InlineKeyboard();
  plist.slice(0, 15).forEach((p, i) => kb.text(`❌ ${i + 1}. ${proxyMgr.short(p)}`, `proxy_del_${i}`).row());
  kb.text("🔙 رجوع", "admin_proxies");
  await ctx.editMessageText("🗑️ *اختر بروكسي للحذف:*", { reply_markup: kb, parse_mode: "Markdown" });
});

bot.callbackQuery(/^proxy_del_\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return;
  const idx = parseInt(ctx.callbackQuery.data.split("_").pop(), 10);
  const plist = proxyMgr.list();
  if (idx < 0 || idx >= plist.length) return ctx.answerCallbackQuery({ text: "❌ خطأ", show_alert: true });
  const short = mdEscape(proxyMgr.short(plist[idx]));
  if (proxyMgr.remove(idx)) {
    await ctx.answerCallbackQuery({ text: "🗑️ تم الحذف" });
    await ctx.editMessageText(`✅ تم حذف البروكسي \`${short}\``, {
      parse_mode: "Markdown",
      reply_markup: proxiesAdminKb(),
    });
  } else {
    await ctx.answerCallbackQuery({ text: "❌ فشل", show_alert: true });
  }
});

bot.callbackQuery("proxy_test_all", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "🔬 جاري الاختبار..." });
  if (ctx.from.id !== ADMIN_ID) return;
  const plist = proxyMgr.list();
  if (!plist.length) return ctx.editMessageText("📭 لا توجد بروكسيات", { reply_markup: proxiesAdminKb() });

  await ctx.editMessageText(`🔬 جاري اختبار ${plist.length} بروكسي (بالتوازي)...`);
  const results = await Promise.all(
    plist.map(async (p) => {
      const [ok, latency, info] = await testOneProxy(p.url);
      if (ok) proxyMgr.markSuccess(p.url);
      else proxyMgr.markFail(p.url);
      return { url: p.url, short: proxyMgr.short(p), ok, latency, info };
    })
  );

  const lines = ["🔬 *نتائج الاختبار*", "━━━━━━━━━━━━━━━━━━━━━━"];
  results.forEach((r, i) => {
    const icon = r.ok ? "✅" : "❌";
    lines.push(`${i + 1}. ${icon} \`${mdEscape(r.short)}\` — \`${r.latency}ms\`\n   └ ${mdEscape(String(r.info))}`);
  });
  const s = proxyMgr.summary();
  lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━\n🟢 متاح: *${s.available}* / *${s.total}*`);
  const text = safeMd(lines.join("\n"));

  try {
    await ctx.editMessageText(text, { reply_markup: proxiesAdminKb(), parse_mode: "Markdown" });
  } catch (_) {
    const plain = text.replace(/[*_`\[\]]/g, "");
    await ctx.editMessageText(plain, { reply_markup: proxiesAdminKb() });
  }
});

// ════════════════════════════════════════════════════════════
// 👑 لوحة الأدمن
// ════════════════════════════════════════════════════════════
bot.callbackQuery("admin_panel", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return ctx.answerCallbackQuery({ text: "⛔ غير مصرح", show_alert: true });
  const usersCount = Object.keys(store.data.users).length;
  const totalAccounts = Object.values(store.data.users).reduce(
    (sum, u) => sum + ((migrateUser(u).accounts || []).length || 0),
    0
  );
  const s = proxyMgr.summary();
  const text =
    "⚙️ *لوحة التحكم — by moon*\n" +
    "━━━━━━━━━━━━━━━━━━━━━━\n" +
    `👥 المستخدمون: *${usersCount}*\n` +
    `📱 الأرقام المسجلة: *${totalAccounts}*\n` +
    `🌐 البروكسيات: *${s.available}* / *${s.total}*`;
  const kb = new InlineKeyboard()
    .text("🌐 إدارة البروكسيات", "admin_proxies").row()
    .text("📣 إذاعة عامة", "admin_broadcast").row()
    .text("📊 إحصائيات", "admin_stats").row()
    .text("🔙 رجوع", "back_main");
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "Markdown" });
});

bot.callbackQuery("admin_stats", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return;
  const usersCount = Object.keys(store.data.users).length;
  const totalAccounts = Object.values(store.data.users).reduce(
    (sum, u) => sum + ((migrateUser(u).accounts || []).length || 0),
    0
  );
  const s = proxyMgr.summary();
  const text =
    "📊 *إحصائيات*\n" +
    "━━━━━━━━━━━━━━━━━━━━━━\n" +
    `👥 المستخدمون: *${usersCount}*\n` +
    `📱 الأرقام: *${totalAccounts}*\n` +
    `⚡ التنشيطات: *${store.data.stats.activations || 0}*\n` +
    `🌐 بروكسيات متاحة: *${s.available}* / *${s.total}*`;
  await ctx.editMessageText(text, {
    reply_markup: new InlineKeyboard().text("🔙 رجوع", "admin_panel"),
    parse_mode: "Markdown",
  });
});

bot.callbackQuery("admin_broadcast", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.from.id !== ADMIN_ID) return;
  ctx.session.adminBroadcast = true;
  await ctx.editMessageText("📣 أرسل نص الإذاعة الآن:", {
    reply_markup: new InlineKeyboard().text("🔙 إلغاء", "admin_panel"),
  });
});

// ════════════════════════════════════════════════════════════
// 🔧 أوامر الأدمن النصية
// ════════════════════════════════════════════════════════════
bot.command("addproxy", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const raw = ctx.match.trim();
  if (!raw) {
    return ctx.reply("`/addproxy http://user:pass@host:port`\nأو أرسل سكربت Python مباشرةً بعد الأمر.", {
      parse_mode: "Markdown",
    });
  }
  const [url, err] = parseProxyInput(raw);
  if (!url) return ctx.reply(`❌ تعذّر الاستخراج:\n\`${mdEscape(err)}\``, { parse_mode: "Markdown" });
  await ctx.reply(`🔬 جاري الاختبار \`${mdEscape(proxyMgr._short(url))}\`...`, { parse_mode: "Markdown" });
  const [ok, latency, info] = await testOneProxy(url);
  if (ok) {
    const [added, reason] = proxyMgr.add(url, "");
    if (!added) return ctx.reply(reason === "exists" ? "⚠️ موجود مسبقاً!" : "❌ صيغة خاطئة");
    await ctx.reply(`✅ *تم الإضافة!*\n⚡ \`${latency}ms\`\n📍 \`${mdEscape(String(info))}\``, { parse_mode: "Markdown" });
  } else {
    const [added, reason] = proxyMgr.add(url, "");
    if (added) {
      await ctx.reply(`⚠️ *فشل الاختبار لكن تمت الإضافة*\n❌ \`${mdEscape(String(info))}\` — \`${latency}ms\``, {
        parse_mode: "Markdown",
      });
    } else {
      await ctx.reply(`❌ فشل الإضافة: ${reason}`);
    }
  }
});

bot.command("delproxy", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const args = ctx.match.trim();
  if (!args) {
    const plist = proxyMgr.list();
    const lines = ["الاستخدام: `/delproxy <index>`\n\nالقائمة:"];
    plist.forEach((p, i) => lines.push(`${i + 1}. \`${mdEscape(proxyMgr.short(p))}\``));
    return ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  }
  const idx = parseInt(args.split(/\s+/)[0], 10) - 1;
  if (isNaN(idx)) return ctx.reply("❌ رقم غير صحيح");
  const plist = proxyMgr.list();
  if (idx < 0 || idx >= plist.length) return ctx.reply("❌ رقم خارج النطاق");
  const short = mdEscape(proxyMgr.short(plist[idx]));
  if (proxyMgr.remove(idx)) {
    await ctx.reply(`🗑️ تم حذف \`${short}\``, { parse_mode: "Markdown" });
  }
});

bot.command("proxies", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const s = proxyMgr.summary();
  const text =
    "🌐 *البروكسيات*\n" +
    "━━━━━━━━━━━━━━━━━━━━━━\n" +
    `📦 الإجمالي: *${s.total}*\n` +
    `✅ نشط: *${s.active}*\n` +
    `🟢 متاح: *${s.available}*\n` +
    `🕒 راحة: *${s.in_cooldown}*\n\n` +
    "الأوامر:\n" +
    "`/addproxy <url>` — إضافة\n" +
    "`/delproxy <index>` — حذف\n" +
    "`/testproxy` — اختبار الكل";
  await ctx.reply(text, { parse_mode: "Markdown" });
});

bot.command("testproxy", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const plist = proxyMgr.list();
  if (!plist.length) return ctx.reply("📭 لا توجد بروكسيات");
  await ctx.reply(`🔬 جاري اختبار ${plist.length} بروكسي (بالتوازي)...`);
  const results = await Promise.all(
    plist.map(async (p) => {
      const [ok, latency, info] = await testOneProxy(p.url);
      if (ok) proxyMgr.markSuccess(p.url);
      else proxyMgr.markFail(p.url);
      return { short: proxyMgr.short(p), ok, latency, info };
    })
  );
  const lines = ["🔬 *نتائج الاختبار*", "━━━━━━━━━━━━━━━━━━━━━━"];
  results.forEach((r, i) => {
    const icon = r.ok ? "✅" : "❌";
    lines.push(`${i + 1}. ${icon} \`${mdEscape(r.short)}\` — \`${r.latency}ms\` — ${mdEscape(String(r.info))}`);
  });
  const s = proxyMgr.summary();
  lines.push(`\n🟢 متاح: *${s.available}* / *${s.total}*`);
  const text = safeMd(lines.join("\n"));
  try {
    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (_) {
    await ctx.reply(text.replace(/[*_`\[\]]/g, ""));
  }
});

// ════════════════════════════════════════════════════════════
// 📣 الإذاعة (تقاطع أي رسالة للأدمن إذا adminBroadcast=true)
// ════════════════════════════════════════════════════════════
bot.on("message:text", async (ctx, next) => {
  if (ctx.from.id !== ADMIN_ID) return next();
  if (!ctx.session.adminBroadcast) return next();
  ctx.session.adminBroadcast = false;
  const text = ctx.message.text;
  const targets = Object.keys(store.data.users);
  await ctx.reply(`⏳ جاري الإرسال إلى ${targets.length}...`);
  let sent = 0;
  await Promise.all(
    targets.map(async (cidStr) => {
      try {
        await bot.api.sendMessage(Number(cidStr), `📢 *إذاعة:*\n\n${text}`, { parse_mode: "Markdown" });
        sent++;
      } catch (_) {}
    })
  );
  await ctx.reply(`✅ تم الإرسال إلى ${sent}/${targets.length}`);
});

// ════════════════════════════════════════════════════════════
// 🚨 معالج الأخطاء العام
// ════════════════════════════════════════════════════════════
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`⚠️ Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("GrammyError:", e.description);
  } else if (e instanceof HttpError) {
    console.error("HttpError:", e.message);
  } else {
    console.error("Unknown error:", e);
  }
});

// ════════════════════════════════════════════════════════════
// 🚀 التشغيل
// ════════════════════════════════════════════════════════════
(async () => {
  const s = proxyMgr.summary();
  console.log(`🌐 البروكسيات:`, s);
  console.log(`⚡ Concurrent handling enabled (grammY)`);
  console.log(`🚀 Starting bot...`);

  if (s.available === 0) {
    try {
      await bot.api.sendMessage(
        ADMIN_ID,
        "🚨 *تنبيه بدء التشغيل:*\nلا يوجد أي بروكسي صالح!\nأضف بروكسي عبر `/addproxy <url>`",
        { parse_mode: "Markdown" }
      );
    } catch (_) {}
  }

  process.on("SIGINT", async () => {
    console.log("\n🛑 Stopping bot...");
    await bot.stop();
    await closeAllClients();
    console.log("✅ Clean shutdown");
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await bot.stop();
    await closeAllClients();
    process.exit(0);
  });

  // تشغيل البوت
  await bot.start({
    allowed_updates: ["message", "callback_query", "inline_query"],
    onStart: (info) => console.log(`🤖 Bot @${info.username} is running`),
  });
})();