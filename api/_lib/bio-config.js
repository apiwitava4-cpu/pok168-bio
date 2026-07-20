const { hasRedisConfig, redisCommand } = require("./redis");
const defaultBioConfig = require("./default-bio-config.json");

const bioConfigKey = "p9:bio:config";

function cleanText(value, fallback = "", maxLength = 300) {
  return String(value || fallback).trim().slice(0, maxLength);
}

function cleanUrl(value, fallback = "") {
  const text = String(value || fallback).trim().replace(/[\r\n]/g, "").slice(0, 1200);
  return /^javascript:/i.test(text) ? fallback : text;
}

function cleanSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeButton(value, index) {
  const button = value && typeof value === "object" ? value : {};
  const label = cleanText(button.label, `Button ${index + 1}`);
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
  const caption = cleanText(image.caption, `Promo ${index + 1}`);
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
  const input = config && typeof config === "object" ? config : defaultBioConfig;
  const rawButtons = Array.isArray(input.buttons) && input.buttons.length ? input.buttons : defaultBioConfig.buttons;
  const rawPromos = Array.isArray(input.promoImages) ? input.promoImages : defaultBioConfig.promoImages;

  return {
    version: 1,
    updatedAt: input.updatedAt || null,
    title: cleanText(input.title, defaultBioConfig.title),
    subtitle: cleanText(input.subtitle, defaultBioConfig.subtitle),
    profileImage: cleanUrl(input.profileImage, defaultBioConfig.profileImage),
    backgroundImage: cleanUrl(input.backgroundImage, defaultBioConfig.backgroundImage),
    footer: cleanText(input.footer, defaultBioConfig.footer),
    buttons: rawButtons.slice(0, 24).map(normalizeButton).filter((button) => button.label),
    promoImages: rawPromos.slice(0, 40).map(normalizePromoImage).filter((image) => image.src)
  };
}

async function getBioConfig() {
  if (!hasRedisConfig()) {
    return normalizeBioConfig(defaultBioConfig);
  }

  const raw = await redisCommand(["GET", bioConfigKey]);
  if (!raw) {
    return normalizeBioConfig(defaultBioConfig);
  }

  try {
    return normalizeBioConfig(JSON.parse(raw));
  } catch (error) {
    return normalizeBioConfig(defaultBioConfig);
  }
}

async function saveBioConfig(input) {
  const config = normalizeBioConfig({
    ...input,
    updatedAt: new Date().toISOString()
  });

  if (!hasRedisConfig()) {
    const error = new Error("missing_storage");
    error.statusCode = 503;
    throw error;
  }

  await redisCommand(["SET", bioConfigKey, JSON.stringify(config)]);
  return config;
}

module.exports = {
  getBioConfig,
  normalizeBioConfig,
  saveBioConfig
};
