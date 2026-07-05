const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");

const rootDir = __dirname;
const dataDir = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(rootDir, "data"));
const statsFile = path.join(dataDir, "click-stats.json");
const bioConfigFile = path.join(dataDir, "bio-config.json");
const uploadDir = path.join(dataDir, "uploads");
const port = Number(process.env.PORT || 8787);
const dashboardUser = process.env.DASHBOARD_USER || "admin";
const dashboardPassword = process.env.DASHBOARD_PASSWORD || "p9bio2026";
const sessions = new Map();
const maxBodyBytes = 12 * 1024 * 1024;

const trackedButtonDefaults = {
  "visit-site": "เข้าชมหน้าเว็บ",
  register: "สมัครสมาชิก",
  promotion: "โปรโมชั่น",
  "contact-admin": "ติดต่อแอดมิน"
};
const directLinkId = "direct";
const directLinkName = "เข้าตรง / ไม่มีรหัสลิงก์";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".csv": "text/csv; charset=utf-8"
};

let writeQueue = Promise.resolve();
let configWriteQueue = Promise.resolve();

function createClickStats() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    totalClicks: 0,
    buttons: Object.fromEntries(
      Object.entries(trackedButtonDefaults).map(([id, label]) => [
        id,
        { id, label, count: 0, lastClickedAt: null }
      ])
    ),
    links: {
      [directLinkId]: createBioLinkRecord(directLinkId, directLinkName, null)
    },
    events: []
  };
}

function createEmptyButtonCounts() {
  return Object.fromEntries(Object.keys(trackedButtonDefaults).map((id) => [id, 0]));
}

function createBioLinkRecord(id, name, createdAt) {
  return {
    id,
    name,
    url: "",
    count: 0,
    buttons: createEmptyButtonCounts(),
    dailyClicks: {},
    bioConfig: null,
    createdAt: createdAt || new Date().toISOString(),
    lastClickedAt: null
  };
}

function createDefaultBioConfig() {
  return {
    version: 1,
    updatedAt: null,
    title: "P9",
    subtitle: "บ้านป๊อกเด้งออนไลน์",
    profileImage: "p9/brand-profile.webp",
    backgroundImage: "p9/bio-background.webp",
    footer: "© P9 BIO",
    buttons: [
      {
        id: "visit-site",
        label: "เข้าชมหน้าเว็บ",
        href: "https://www.pok9thai.com/?utm_source=bio&utm_medium=button&utm_campaign=p9_service",
        trackId: "visit-site",
        action: "link",
        enabled: true,
        targetBlank: true
      },
      {
        id: "register",
        label: "สมัครสมาชิก",
        href: "https://ag.p9deng.com/?code=AG0239EW&utm_source=bio&utm_medium=button&utm_campaign=p9_service",
        trackId: "register",
        action: "link",
        enabled: true,
        targetBlank: true
      },
      {
        id: "promotion",
        label: "โปรโมชั่น",
        href: "#",
        trackId: "promotion",
        action: "promo",
        enabled: true,
        targetBlank: false
      },
      {
        id: "contact-admin",
        label: "ติดต่อแอดมิน",
        href: "https://lin.ee/tQqumsi?utm_source=bio&utm_medium=button&utm_campaign=p9_service",
        trackId: "contact-admin",
        action: "link",
        enabled: true,
        targetBlank: true
      }
    ],
    promoImages: [
      { id: "promo-new-member", src: "promo/promo-new-member.webp", caption: "สมาชิกใหม่", alt: "โปรโมชั่นสมาชิกใหม่", enabled: true },
      { id: "promo-daily-10", src: "promo/promo-daily-10.webp", caption: "รับ 10% ทุกวัน", alt: "โปรโมชั่นรับ 10 เปอร์เซ็นต์ทุกวัน", enabled: true },
      { id: "promo-cashback-2", src: "promo/promo-cashback-2.webp", caption: "คืนยอด 2%", alt: "โปรโมชั่นคืนยอด 2 เปอร์เซ็นต์", enabled: true },
      { id: "promo-special-event", src: "promo/promo-special-event.webp", caption: "กิจกรรมพิเศษ", alt: "โปรโมชั่นกิจกรรมพิเศษ", enabled: true },
      { id: "promo-pokdeng-online", src: "promo/promo-pokdeng-online.webp", caption: "ป๊อกเด้งออนไลน์", alt: "โปรโมชั่นป๊อกเด้งออนไลน์", enabled: true },
      { id: "promo-5", src: "promo/promo-5.webp", caption: "โปรโมชั่น 5", alt: "โปรโมชั่น 5", enabled: true }
    ]
  };
}

function getBangkokDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + (7 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function cleanSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function createRandomSlug() {
  return `bio-${crypto.randomBytes(3).toString("hex")}`;
}

function getPublicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

function buildBioUrl(req, sourceId) {
  const url = new URL("/", getPublicBaseUrl(req));
  if (sourceId && sourceId !== directLinkId) {
    url.searchParams.set("ref", sourceId);
  }
  return url.toString();
}

function normalizeBioLink(id, value) {
  const link = value && typeof value === "object" ? value : {};
  const normalizedId = cleanSlug(link.id || id) || directLinkId;
  const buttons = link.buttons && typeof link.buttons === "object" ? link.buttons : {};
  const dailyClicks = link.dailyClicks && typeof link.dailyClicks === "object" ? link.dailyClicks : {};
  const bioConfig = link.bioConfig && typeof link.bioConfig === "object" ? normalizeBioConfig(link.bioConfig) : null;

  return {
    id: normalizedId,
    name: cleanText(link.name, normalizedId === directLinkId ? directLinkName : normalizedId),
    url: cleanText(link.url),
    count: Number(link.count) || 0,
    buttons: Object.fromEntries(
      Object.keys(trackedButtonDefaults).map((buttonId) => [buttonId, Number(buttons[buttonId]) || 0])
    ),
    dailyClicks: Object.fromEntries(
      Object.entries(dailyClicks)
        .filter(([dateKey]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
        .map(([dateKey, count]) => [dateKey, Number(count) || 0])
    ),
    bioConfig,
    createdAt: link.createdAt || null,
    lastClickedAt: link.lastClickedAt || null
  };
}

function normalizeStats(stats) {
  const normalized = stats && typeof stats === "object" ? stats : createClickStats();

  if (!normalized.buttons || typeof normalized.buttons !== "object") {
    normalized.buttons = {};
  }

  Object.entries(trackedButtonDefaults).forEach(([id, label]) => {
    if (!normalized.buttons[id]) {
      normalized.buttons[id] = { id, label, count: 0, lastClickedAt: null };
    }
    normalized.buttons[id].id = id;
    normalized.buttons[id].label = normalized.buttons[id].label || label;
    normalized.buttons[id].count = Number(normalized.buttons[id].count) || 0;
    normalized.buttons[id].lastClickedAt = normalized.buttons[id].lastClickedAt || null;
  });

  if (!Array.isArray(normalized.events)) {
    normalized.events = [];
  }

  if (!normalized.links || typeof normalized.links !== "object") {
    normalized.links = {};
  }

  normalized.links = Object.fromEntries(
    Object.entries(normalized.links).map(([id, link]) => {
      const normalizedLink = normalizeBioLink(id, link);
      return [normalizedLink.id, normalizedLink];
    })
  );

  if (!normalized.links[directLinkId]) {
    normalized.links[directLinkId] = createBioLinkRecord(directLinkId, directLinkName, null);
  }

  normalized.totalClicks = Object.values(normalized.buttons).reduce(
    (sum, button) => sum + (Number(button.count) || 0),
    0
  );

  return normalized;
}

async function ensureDataFile() {
  await fsp.mkdir(dataDir, { recursive: true });

  if (!fs.existsSync(statsFile)) {
    await fsp.writeFile(statsFile, JSON.stringify(createClickStats(), null, 2), "utf8");
  }
}

async function readStats() {
  await ensureDataFile();
  try {
    return normalizeStats(JSON.parse(await fsp.readFile(statsFile, "utf8")));
  } catch (error) {
    return createClickStats();
  }
}

async function writeStats(stats) {
  await ensureDataFile();
  await fsp.writeFile(statsFile, JSON.stringify(normalizeStats(stats), null, 2), "utf8");
}

function send(res, statusCode, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(payload);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return index === -1
          ? [cookie, ""]
          : [decodeURIComponent(cookie.slice(0, index)), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

function getSession(req) {
  const token = parseCookies(req).p9BioSession;
  if (!token || !sessions.has(token)) {
    return null;
  }

  return sessions.get(token);
}

function requireSession(req, res) {
  if (getSession(req)) {
    return true;
  }

  send(res, 401, { ok: false, error: "unauthorized" });
  return false;
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `p9BioSession=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "p9BioSession=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBodyBytes) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function cleanText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 300);
}

function cleanUrl(value, fallback = "") {
  const text = String(value || fallback).trim().replace(/[\r\n]/g, "").slice(0, 1200);
  return /^javascript:/i.test(text) ? fallback : text;
}

function normalizeBioButton(value, index) {
  const button = value && typeof value === "object" ? value : {};
  const label = cleanText(button.label, `ปุ่ม ${index + 1}`);
  const id = cleanSlug(button.id || button.trackId || label) || `button-${index + 1}`;
  const action = button.action === "promo" || id === "promotion" ? "promo" : "link";

  return {
    id,
    label,
    href: action === "promo" ? "#" : cleanUrl(button.href),
    trackId: cleanSlug(button.trackId || id) || id,
    action,
    enabled: button.enabled !== false,
    targetBlank: action === "promo" ? false : button.targetBlank !== false
  };
}

function normalizePromoImage(value, index) {
  const image = value && typeof value === "object" ? value : {};
  const caption = cleanText(image.caption, `โปรโมชั่น ${index + 1}`);
  const id = cleanSlug(image.id || caption) || `promo-${index + 1}`;

  return {
    id,
    src: cleanUrl(image.src),
    caption,
    alt: cleanText(image.alt, caption),
    enabled: image.enabled !== false
  };
}

function normalizeBioConfig(config) {
  const defaults = createDefaultBioConfig();
  const input = config && typeof config === "object" ? config : defaults;
  const rawButtons = Array.isArray(input.buttons) && input.buttons.length ? input.buttons : defaults.buttons;
  const rawPromos = Array.isArray(input.promoImages) ? input.promoImages : defaults.promoImages;
  const buttons = rawButtons.slice(0, 24).map(normalizeBioButton).filter((button) => button.label);
  const promoImages = rawPromos.slice(0, 40).map(normalizePromoImage).filter((image) => image.src);

  if (!buttons.some((button) => button.action === "promo")) {
    buttons.splice(2, 0, normalizeBioButton(defaults.buttons[2], 2));
  }

  return {
    version: 1,
    updatedAt: input.updatedAt || null,
    title: cleanText(input.title, defaults.title),
    subtitle: cleanText(input.subtitle, defaults.subtitle),
    profileImage: cleanUrl(input.profileImage, defaults.profileImage),
    backgroundImage: cleanUrl(input.backgroundImage, defaults.backgroundImage),
    footer: cleanText(input.footer, defaults.footer),
    buttons,
    promoImages
  };
}

async function ensureBioConfigFile() {
  await fsp.mkdir(dataDir, { recursive: true });

  if (!fs.existsSync(bioConfigFile)) {
    await fsp.writeFile(bioConfigFile, JSON.stringify(createDefaultBioConfig(), null, 2), "utf8");
  }
}

async function readBioConfig() {
  await ensureBioConfigFile();
  try {
    return normalizeBioConfig(JSON.parse(await fsp.readFile(bioConfigFile, "utf8")));
  } catch (error) {
    return createDefaultBioConfig();
  }
}

async function writeBioConfig(config) {
  await ensureBioConfigFile();
  const normalized = normalizeBioConfig({
    ...config,
    updatedAt: new Date().toISOString()
  });
  await fsp.writeFile(bioConfigFile, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function getAllStatsButtons(stats) {
  const knownButtons = Object.entries(trackedButtonDefaults).map(([id, label]) => {
    const button = stats.buttons[id] || { id, label, count: 0, lastClickedAt: "" };
    return { id, label: button.label || label, count: Number(button.count) || 0, lastClickedAt: button.lastClickedAt || "" };
  });
  const customButtons = Object.entries(stats.buttons || {})
    .filter(([id]) => !trackedButtonDefaults[id])
    .map(([id, button]) => ({
      id,
      label: button.label || id,
      count: Number(button.count) || 0,
      lastClickedAt: button.lastClickedAt || ""
    }));

  return knownButtons.concat(customButtons).sort((a, b) => (b.count || 0) - (a.count || 0));
}

async function handleGetBioConfig(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sourceId = cleanSlug(url.searchParams.get("ref") || url.searchParams.get("source") || url.searchParams.get("bio"));

  if (sourceId && sourceId !== directLinkId) {
    const stats = await readStats();
    const link = stats.links && stats.links[sourceId];
    if (link && link.bioConfig) {
      send(res, 200, {
        ...link.bioConfig,
        sourceId,
        sourceName: link.name
      });
      return;
    }
  }

  send(res, 200, await readBioConfig());
}

async function handleUpdateBioConfig(req, res) {
  const body = await readBody(req);

  configWriteQueue = configWriteQueue.then(async () => {
    const config = await writeBioConfig(body);
    send(res, 200, { ok: true, config });
  });

  await configWriteQueue;
}

async function handleUploadImage(req, res) {
  const body = await readBody(req);
  const mimeType = cleanText(body.type || body.mimeType).toLowerCase();
  const filename = cleanText(body.name || "upload");
  const allowedTypes = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  const extension = allowedTypes[mimeType];

  if (!extension || !body.data) {
    send(res, 400, { ok: false, error: "invalid_image" });
    return;
  }

  const base64 = String(body.data).includes(",") ? String(body.data).split(",").pop() : String(body.data);
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    send(res, 400, { ok: false, error: "invalid_image_size" });
    return;
  }

  await fsp.mkdir(uploadDir, { recursive: true });
  const safeBase = cleanSlug(path.parse(filename).name) || "image";
  const savedName = `${Date.now()}-${safeBase}${extension}`;
  const filePath = path.join(uploadDir, savedName);
  await fsp.writeFile(filePath, buffer);

  send(res, 201, {
    ok: true,
    url: `/uploads/${savedName}`,
    name: savedName
  });
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.socket.remoteAddress || "").split(",")[0].trim();
}

function getClickSource(body) {
  const sourceId = cleanSlug(body.sourceId || body.ref || body.utmSource || body.utm_source) || directLinkId;
  return {
    id: sourceId,
    name: cleanText(body.sourceName || body.sourceLabel || body.utmCampaign || body.utm_campaign, sourceId === directLinkId ? directLinkName : sourceId),
    url: cleanText(body.sourceUrl)
  };
}

async function handleClick(req, res) {
  const body = await readBody(req);
  const id = cleanSlug(body.id);

  if (!id) {
    send(res, 400, { ok: false, error: "invalid_button" });
    return;
  }

  const label = cleanText(body.label, trackedButtonDefaults[id] || id);
  const now = new Date().toISOString();
  const dayKey = getBangkokDateKey(now);
  const source = getClickSource(body);

  writeQueue = writeQueue.then(async () => {
    const stats = await readStats();

    if (!stats.buttons[id]) {
      stats.buttons[id] = { id, label, count: 0, lastClickedAt: null };
    }

    stats.buttons[id].label = label;
    stats.buttons[id].count += 1;
    stats.buttons[id].lastClickedAt = now;
    stats.totalClicks += 1;
    stats.updatedAt = now;

    if (!stats.links[source.id]) {
      stats.links[source.id] = createBioLinkRecord(source.id, source.name, now);
    }
    stats.links[source.id].name = stats.links[source.id].name || source.name;
    stats.links[source.id].url = stats.links[source.id].url || source.url || buildBioUrl(req, source.id);
    stats.links[source.id].count += 1;
    stats.links[source.id].buttons[id] = (Number(stats.links[source.id].buttons[id]) || 0) + 1;
    stats.links[source.id].dailyClicks[dayKey] = (Number(stats.links[source.id].dailyClicks[dayKey]) || 0) + 1;
    stats.links[source.id].lastClickedAt = now;

    stats.events.unshift({
      id,
      label,
      href: cleanText(body.href),
      page: cleanText(body.page),
      sourceId: source.id,
      sourceName: stats.links[source.id].name,
      sourceUrl: stats.links[source.id].url,
      clickedAt: now,
      ip: getClientIp(req),
      userAgent: cleanText(req.headers["user-agent"])
    });
    stats.events = stats.events.slice(0, 1000);

    await writeStats(stats);
    send(res, 201, { ok: true, totalClicks: stats.totalClicks, sourceId: source.id });
  });

  await writeQueue;
}

async function handleCreateBioLink(req, res) {
  const body = await readBody(req);
  const name = cleanText(body.name || body.platform || body.label, "ลิงก์ Bio");
  const requestedId = cleanSlug(body.id || body.slug || name);
  const now = new Date().toISOString();

  writeQueue = writeQueue.then(async () => {
    const stats = await readStats();
    const bioConfig = await readBioConfig();
    let id = requestedId || createRandomSlug();

    while (id === directLinkId || (stats.links[id] && !requestedId)) {
      id = createRandomSlug();
    }

    if (!stats.links[id]) {
      stats.links[id] = createBioLinkRecord(id, name, now);
      stats.links[id].bioConfig = bioConfig;
    } else {
      stats.links[id].name = name || stats.links[id].name;
    }

    stats.links[id].url = buildBioUrl(req, id);
    await writeStats(stats);

    send(res, 201, {
      ok: true,
      link: {
        ...stats.links[id],
        url: stats.links[id].url
      }
    });
  });

  await writeQueue;
}

async function handleLogin(req, res) {
  const body = await readBody(req);

  if (body.username === dashboardUser && body.password === dashboardPassword) {
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { username: dashboardUser, createdAt: Date.now() });
    setSessionCookie(res, token);
    send(res, 200, { ok: true });
    return;
  }

  send(res, 401, { ok: false, error: "invalid_credentials" });
}

async function handleLogout(req, res) {
  const token = parseCookies(req).p9BioSession;
  if (token) {
    sessions.delete(token);
  }
  clearSessionCookie(res);
  send(res, 200, { ok: true });
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function statsToCsv(stats) {
  const lines = [
    ["button_stats"].map(csvCell).join(","),
    ["button_id", "button_label", "clicks", "last_clicked_at"].map(csvCell).join(",")
  ];

  getAllStatsButtons(stats).forEach((button) => {
    const id = button.id;
    lines.push([id, button.label, button.count, button.lastClickedAt || ""].map(csvCell).join(","));
  });

  lines.push("");
  lines.push(["bio_link_stats"].map(csvCell).join(","));
  lines.push(["link_id", "link_name", "link_url", "clicks", "last_clicked_at"].map(csvCell).join(","));
  Object.values(stats.links || {})
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .forEach((link) => {
      lines.push([link.id, link.name, link.url || "", link.count || 0, link.lastClickedAt || ""].map(csvCell).join(","));
    });

  lines.push("");
  lines.push(["bio_link_daily_stats"].map(csvCell).join(","));
  lines.push(["link_id", "link_name", "date", "clicks"].map(csvCell).join(","));
  Object.values(stats.links || {})
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .forEach((link) => {
      Object.entries(link.dailyClicks || {})
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .forEach(([dateKey, count]) => {
          lines.push([link.id, link.name, dateKey, count || 0].map(csvCell).join(","));
        });
    });

  return lines.join("\n");
}

function resetClickCounts(stats) {
  const reset = createClickStats();
  reset.links = Object.fromEntries(
    Object.entries(stats.links || {}).map(([id, link]) => {
      const normalized = normalizeBioLink(id, link);
      return [
        normalized.id,
        {
          ...normalized,
          count: 0,
          buttons: createEmptyButtonCounts(),
          dailyClicks: {},
          lastClickedAt: null
        }
      ];
    })
  );
  return reset;
}

async function handleStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^[/\\]+/, "");
  const filePath = path.resolve(rootDir, safePath);

  if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600"
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    send(res, 404, "Not found");
  }
}

async function handleUploadedFile(req, res, pathname) {
  const safePath = path.normalize(decodeURIComponent(pathname.replace(/^\/uploads\/?/, ""))).replace(/^[/\\]+/, "");
  const filePath = path.resolve(uploadDir, safePath);

  if (filePath !== uploadDir && !filePath.startsWith(uploadDir + path.sep)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable"
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    send(res, 404, "Not found");
  }
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bio-config") {
      await handleGetBioConfig(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/bio-config") {
      if (!requireSession(req, res)) {
        return;
      }
      await handleUpdateBioConfig(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/uploads") {
      if (!requireSession(req, res)) {
        return;
      }
      await handleUploadImage(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/clicks") {
      await handleClick(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      await handleLogin(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/links") {
      if (!requireSession(req, res)) {
        return;
      }
      await handleCreateBioLink(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      await handleLogout(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      send(res, 200, { ok: true, authenticated: Boolean(getSession(req)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      if (!requireSession(req, res)) {
        return;
      }
      send(res, 200, await readStats());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      if (!requireSession(req, res)) {
        return;
      }
      await writeStats(resetClickCounts(await readStats()));
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/export.csv") {
      if (!requireSession(req, res)) {
        return;
      }
      const csv = statsToCsv(await readStats());
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="p9-click-stats.csv"',
        "Cache-Control": "no-store"
      });
      res.end(csv);
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin") {
      redirect(res, "/dashboard.html");
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/uploads/")) {
      await handleUploadedFile(req, res, url.pathname);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await handleStatic(req, res, url.pathname);
      return;
    }

    send(res, 405, { ok: false, error: "method_not_allowed" });
  } catch (error) {
    if (error.message === "Invalid JSON" || error.message === "Body too large") {
      send(res, 400, { ok: false, error: error.message });
      return;
    }

    console.error(error);
    send(res, 500, { ok: false, error: "server_error" });
  }
}

ensureDataFile()
  .then(() => {
    http.createServer(handleRequest).listen(port, () => {
      console.log(`P9 Bio analytics running at http://localhost:${port}`);
      console.log(`Dashboard: http://localhost:${port}/dashboard.html`);
    });
  })
  .catch((error) => {
    console.error("Unable to start server", error);
    process.exit(1);
  });
