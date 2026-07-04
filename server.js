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
    createdAt: createdAt || new Date().toISOString(),
    lastClickedAt: null
  };
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

  return {
    id: normalizedId,
    name: cleanText(link.name, normalizedId === directLinkId ? directLinkName : normalizedId),
    url: cleanText(link.url),
    count: Number(link.count) || 0,
    buttons: Object.fromEntries(
      Object.keys(trackedButtonDefaults).map((buttonId) => [buttonId, Number(buttons[buttonId]) || 0])
    ),
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
  const id = cleanText(body.id);

  if (!id || !trackedButtonDefaults[id]) {
    send(res, 400, { ok: false, error: "invalid_button" });
    return;
  }

  const label = cleanText(body.label, trackedButtonDefaults[id]);
  const now = new Date().toISOString();
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
    let id = requestedId || createRandomSlug();

    while (id === directLinkId || (stats.links[id] && !requestedId)) {
      id = createRandomSlug();
    }

    if (!stats.links[id]) {
      stats.links[id] = createBioLinkRecord(id, name, now);
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

  Object.keys(trackedButtonDefaults).forEach((id) => {
    const button = stats.buttons[id] || { id, label: trackedButtonDefaults[id], count: 0, lastClickedAt: "" };
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
