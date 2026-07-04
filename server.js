const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const http = require("http");
const path = require("path");

const rootDir = __dirname;
const dataDir = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(rootDir, "data"));
const statsFile = path.join(dataDir, "click-stats.json");
const port = Number(process.env.PORT || 8787);
const dashboardUser = process.env.DASHBOARD_USER || "admin";
const dashboardPassword = process.env.DASHBOARD_PASSWORD || "p9bio2026";
const sessions = new Map();

const trackedButtonDefaults = {
  "visit-site": "เข้าชมหน้าเว็บ",
  register: "สมัครสมาชิก",
  promotion: "โปรโมชั่น",
  "contact-admin": "ติดต่อแอดมิน"
};

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
    events: []
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
      if (body.length > 1024 * 1024) {
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

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.socket.remoteAddress || "").split(",")[0].trim();
}

async function handleClick(req, res) {
  const body = await readBody(req);
  const id = cleanText(body.id);

  if (!id || !trackedButtonDefaults[id]) {
    send(res, 400, { ok: false, error: "invalid_button" });
    return;
  }

  const label = cleanText(body.label, trackedButtonDefaults[id]);
  const now = new Date().toISOString();

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
    stats.events.unshift({
      id,
      label,
      href: cleanText(body.href),
      page: cleanText(body.page),
      clickedAt: now,
      ip: getClientIp(req),
      userAgent: cleanText(req.headers["user-agent"])
    });
    stats.events = stats.events.slice(0, 1000);

    await writeStats(stats);
    send(res, 201, { ok: true, totalClicks: stats.totalClicks });
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
    ["button_id", "button_label", "clicks", "last_clicked_at"].map(csvCell).join(",")
  ];

  Object.keys(trackedButtonDefaults).forEach((id) => {
    const button = stats.buttons[id] || { id, label: trackedButtonDefaults[id], count: 0, lastClickedAt: "" };
    lines.push([id, button.label, button.count, button.lastClickedAt || ""].map(csvCell).join(","));
  });

  return lines.join("\n");
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

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      send(res, 200, { ok: true });
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
      await writeStats(createClickStats());
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
