const { redisCommand, redisPipeline } = require("./redis");

const trackedButtonDefaults = {
  "visit-site": "เข้าชมหน้าเว็บ",
  register: "สมัครสมาชิก",
  promotion: "โปรโมชั่น",
  "contact-admin": "ติดต่อแอดมิน"
};

const keys = {
  total: "p9:bio:stats:total",
  updatedAt: "p9:bio:stats:updatedAt",
  counts: "p9:bio:stats:counts",
  lastClicks: "p9:bio:stats:lastClicks",
  events: "p9:bio:stats:events"
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
    events: []
  };
}

async function getStats() {
  const [total, updatedAt, rawCounts, rawLastClicks, rawEvents] = await redisPipeline([
    ["GET", keys.total],
    ["GET", keys.updatedAt],
    ["HGETALL", keys.counts],
    ["HGETALL", keys.lastClicks],
    ["LRANGE", keys.events, 0, 999]
  ]);
  const counts = hgetallToObject(rawCounts);
  const lastClicks = hgetallToObject(rawLastClicks);
  const events = normalizeEvents(rawEvents);

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
  const event = {
    id,
    label: cleanText(input.label, trackedButtonDefaults[id]),
    href: cleanText(input.href),
    page: cleanText(input.page),
    clickedAt: now,
    ip: getClientIp(req),
    userAgent: cleanText(req.headers["user-agent"])
  };

  const [buttonCount, , totalClicks] = await redisPipeline([
    ["HINCRBY", keys.counts, id, 1],
    ["HSET", keys.lastClicks, id, now],
    ["INCR", keys.total],
    ["SET", keys.updatedAt, now],
    ["LPUSH", keys.events, JSON.stringify(event)],
    ["LTRIM", keys.events, 0, 999]
  ]);

  return {
    ok: true,
    id,
    buttonCount: Number(buttonCount) || 0,
    totalClicks: Number(totalClicks) || 0
  };
}

async function resetStats() {
  await redisCommand(["DEL", keys.total, keys.updatedAt, keys.counts, keys.lastClicks, keys.events]);
  return { ok: true };
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

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.socket?.remoteAddress || "").split(",")[0].trim();
}

module.exports = {
  createEmptyStats,
  getStats,
  recordClick,
  resetStats,
  statsToCsv,
  trackedButtonDefaults
};
