const { redisCommand, redisPipeline } = require("./redis");

const trackedButtonDefaults = {
  "visit-site": "เข้าชมหน้าเว็บ",
  register: "สมัครสมาชิก",
  promotion: "โปรโมชั่น",
  "contact-admin": "ติดต่อแอดมิน"
};
const directLinkId = "direct";
const directLinkName = "เข้าตรง / ไม่มีรหัสลิงก์";

const keys = {
  total: "p9:bio:stats:total",
  updatedAt: "p9:bio:stats:updatedAt",
  counts: "p9:bio:stats:counts",
  lastClicks: "p9:bio:stats:lastClicks",
  events: "p9:bio:stats:events",
  links: "p9:bio:stats:links",
  linkCounts: "p9:bio:stats:linkCounts",
  linkLastClicks: "p9:bio:stats:linkLastClicks",
  linkButtonCounts: "p9:bio:stats:linkButtonCounts",
  linkDailyCounts: "p9:bio:stats:linkDailyCounts"
};

function hgetallToObject(value) {
  if (!value) {
    return {};
  }

  if (!Array.isArray(value)) {
    return value;
  }

  const output = {};
  for (let index = 0; index < value.length; index += 2) {
    output[value[index]] = value[index + 1];
  }
  return output;
}

function cleanText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 300);
}

function createEmptyButtonCounts() {
  return Object.fromEntries(Object.keys(trackedButtonDefaults).map((id) => [id, 0]));
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
  return `bio-${Math.random().toString(16).slice(2, 8)}`;
}

function getBangkokDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + (7 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function getPublicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
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

function createBioLinkRecord(id, name, createdAt) {
  return {
    id,
    name,
    url: "",
    count: 0,
    buttons: createEmptyButtonCounts(),
    dailyClicks: {},
    createdAt: createdAt || new Date().toISOString(),
    lastClickedAt: null
  };
}

function normalizeBioLink(id, value) {
  const link = value && typeof value === "object" ? value : {};
  const normalizedId = cleanSlug(link.id || id) || directLinkId;
  const buttons = link.buttons && typeof link.buttons === "object" ? link.buttons : {};
  const dailyClicks = link.dailyClicks && typeof link.dailyClicks === "object" ? link.dailyClicks : {};

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
    createdAt: link.createdAt || null,
    lastClickedAt: link.lastClickedAt || null
  };
}

function parseLinkRecords(rawLinks, counts, lastClicks, buttonCounts, dailyCounts) {
  const linkRecords = hgetallToObject(rawLinks);
  const output = {};

  Object.entries(linkRecords).forEach(([id, raw]) => {
    try {
      output[id] = normalizeBioLink(id, typeof raw === "string" ? JSON.parse(raw) : raw);
    } catch (error) {
      output[id] = normalizeBioLink(id, { id, name: id });
    }
  });

  if (!output[directLinkId]) {
    output[directLinkId] = createBioLinkRecord(directLinkId, directLinkName, null);
  }

  Object.entries(hgetallToObject(counts)).forEach(([id, count]) => {
    if (!output[id]) {
      output[id] = createBioLinkRecord(id, id, null);
    }
    output[id].count = Number(count) || 0;
  });

  Object.entries(hgetallToObject(lastClicks)).forEach(([id, lastClickedAt]) => {
    if (!output[id]) {
      output[id] = createBioLinkRecord(id, id, null);
    }
    output[id].lastClickedAt = lastClickedAt || null;
  });

  Object.entries(hgetallToObject(buttonCounts)).forEach(([field, count]) => {
    const index = field.indexOf(":");
    if (index === -1) {
      return;
    }
    const linkId = field.slice(0, index);
    const buttonId = field.slice(index + 1);
    if (!output[linkId]) {
      output[linkId] = createBioLinkRecord(linkId, linkId, null);
    }
    output[linkId].buttons[buttonId] = Number(count) || 0;
  });

  Object.entries(hgetallToObject(dailyCounts)).forEach(([field, count]) => {
    const index = field.indexOf(":");
    if (index === -1) {
      return;
    }
    const linkId = field.slice(0, index);
    const dateKey = field.slice(index + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return;
    }
    if (!output[linkId]) {
      output[linkId] = createBioLinkRecord(linkId, linkId, null);
    }
    output[linkId].dailyClicks[dateKey] = Number(count) || 0;
  });

  return output;
}

function getClickSource(input) {
  const sourceId = cleanSlug(input.sourceId || input.ref || input.utmSource || input.utm_source) || directLinkId;
  return {
    id: sourceId,
    name: cleanText(input.sourceName || input.sourceLabel || input.utmCampaign || input.utm_campaign, sourceId === directLinkId ? directLinkName : sourceId),
    url: cleanText(input.sourceUrl)
  };
}

function normalizeEvents(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    try {
      return typeof item === "string" ? JSON.parse(item) : item;
    } catch (error) {
      return null;
    }
  }).filter(Boolean);
}

function createEmptyStats() {
  return {
    version: 1,
    createdAt: null,
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

async function getStats() {
  const [total, updatedAt, rawCounts, rawLastClicks, rawEvents, rawLinks, rawLinkCounts, rawLinkLastClicks, rawLinkButtonCounts, rawLinkDailyCounts] = await redisPipeline([
    ["GET", keys.total],
    ["GET", keys.updatedAt],
    ["HGETALL", keys.counts],
    ["HGETALL", keys.lastClicks],
    ["LRANGE", keys.events, 0, 999],
    ["HGETALL", keys.links],
    ["HGETALL", keys.linkCounts],
    ["HGETALL", keys.linkLastClicks],
    ["HGETALL", keys.linkButtonCounts],
    ["HGETALL", keys.linkDailyCounts]
  ]);
  const counts = hgetallToObject(rawCounts);
  const lastClicks = hgetallToObject(rawLastClicks);
  const events = normalizeEvents(rawEvents);
  const links = parseLinkRecords(rawLinks, rawLinkCounts, rawLinkLastClicks, rawLinkButtonCounts, rawLinkDailyCounts);

  return {
    version: 1,
    createdAt: null,
    updatedAt: updatedAt || null,
    totalClicks: Number(total) || 0,
    buttons: Object.fromEntries(
      Object.entries(trackedButtonDefaults).map(([id, label]) => [
        id,
        {
          id,
          label,
          count: Number(counts[id]) || 0,
          lastClickedAt: lastClicks[id] || null
        }
      ])
    ),
    links,
    events
  };
}

async function recordClick(input, req) {
  const id = cleanText(input.id);

  if (!id || !trackedButtonDefaults[id]) {
    const error = new Error("invalid_button");
    error.statusCode = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const dayKey = getBangkokDateKey(now);
  const source = getClickSource(input);
  const existingLinkRaw = await redisCommand(["HGET", keys.links, source.id]);
  let linkRecord = createBioLinkRecord(source.id, source.name, now);
  if (existingLinkRaw) {
    try {
      linkRecord = normalizeBioLink(source.id, JSON.parse(existingLinkRaw));
    } catch (error) {
      linkRecord = normalizeBioLink(source.id, { id: source.id, name: source.name });
    }
  }
  linkRecord.name = linkRecord.name || source.name;
  linkRecord.url = linkRecord.url || source.url || buildBioUrl(req, source.id);

  const event = {
    id,
    label: cleanText(input.label, trackedButtonDefaults[id]),
    href: cleanText(input.href),
    page: cleanText(input.page),
    sourceId: source.id,
    sourceName: linkRecord.name,
    sourceUrl: linkRecord.url,
    clickedAt: now,
    ip: getClientIp(req),
    userAgent: cleanText(req.headers["user-agent"])
  };

  const [buttonCount, , totalClicks, , linkCount] = await redisPipeline([
    ["HINCRBY", keys.counts, id, 1],
    ["HSET", keys.lastClicks, id, now],
    ["INCR", keys.total],
    ["SET", keys.updatedAt, now],
    ["HINCRBY", keys.linkCounts, source.id, 1],
    ["HINCRBY", keys.linkButtonCounts, `${source.id}:${id}`, 1],
    ["HINCRBY", keys.linkDailyCounts, `${source.id}:${dayKey}`, 1],
    ["HSET", keys.linkLastClicks, source.id, now],
    ["HSET", keys.links, source.id, JSON.stringify(linkRecord)],
    ["LPUSH", keys.events, JSON.stringify(event)],
    ["LTRIM", keys.events, 0, 999]
  ]);

  return {
    ok: true,
    id,
    sourceId: source.id,
    buttonCount: Number(buttonCount) || 0,
    linkCount: Number(linkCount) || 0,
    totalClicks: Number(totalClicks) || 0
  };
}

async function createBioLink(input, req) {
  const name = cleanText(input.name || input.platform || input.label, "ลิงก์ Bio");
  const requestedId = cleanSlug(input.id || input.slug || name);
  let id = requestedId || createRandomSlug();
  const now = new Date().toISOString();

  while (id === directLinkId) {
    id = createRandomSlug();
  }

  const existingRaw = await redisCommand(["HGET", keys.links, id]);
  let link = createBioLinkRecord(id, name, now);
  if (existingRaw) {
    try {
      link = normalizeBioLink(id, JSON.parse(existingRaw));
    } catch (error) {
      link = normalizeBioLink(id, { id, name });
    }
  }
  link.name = name || link.name;
  link.url = buildBioUrl(req, id);

  await redisCommand(["HSET", keys.links, id, JSON.stringify(link)]);

  return {
    ok: true,
    link
  };
}

async function resetStats() {
  await redisCommand(["DEL", keys.total, keys.updatedAt, keys.counts, keys.lastClicks, keys.events, keys.linkCounts, keys.linkLastClicks, keys.linkButtonCounts, keys.linkDailyCounts]);
  return { ok: true };
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

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.socket?.remoteAddress || "").split(",")[0].trim();
}

module.exports = {
  createBioLink,
  createEmptyStats,
  getStats,
  recordClick,
  resetStats,
  statsToCsv,
  trackedButtonDefaults
};
