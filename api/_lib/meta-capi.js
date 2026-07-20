const defaultPixelId = "1486638606565223";
const defaultGraphApiVersion = "v25.0";

const metaButtonEvents = {
  "visit-site": "BioVisitSiteClick",
  register: "Lead",
  promotion: "BioPromotionOpen",
  "contact-admin": "Contact"
};

function cleanText(value, fallback = "", maxLength = 300) {
  return String(value || fallback).trim().slice(0, maxLength);
}

function getMetaPixelId() {
  return cleanText(process.env.META_PIXEL_ID || defaultPixelId);
}

function getMetaCapiAccessToken() {
  return cleanText(process.env.META_CAPI_ACCESS_TOKEN, "", 1000);
}

function getGraphApiVersion() {
  return cleanText(process.env.META_GRAPH_API_VERSION || defaultGraphApiVersion);
}

function isMetaCapiConfigured() {
  return Boolean(getMetaPixelId() && getMetaCapiAccessToken());
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return Array.isArray(forwarded)
    ? forwarded[0]
    : String(forwarded || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function getPublicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

function getEventSourceUrl(req, input, event) {
  const sourceUrl = cleanText(input.sourceUrl || event.sourceUrl, "", 1200);
  if (sourceUrl) {
    return sourceUrl;
  }

  const page = cleanText(input.page || event.page, "/", 1200);
  try {
    return new URL(page || "/", getPublicBaseUrl(req)).toString();
  } catch (error) {
    return getPublicBaseUrl(req);
  }
}

function getMetaEventName(input, event) {
  return cleanText(input.metaEventName || event.metaEventName || metaButtonEvents[event.id] || "BioButtonClick");
}

function getUserData(req, input) {
  const userData = {
    client_ip_address: getClientIp(req),
    client_user_agent: cleanText(req.headers["user-agent"], "", 1000)
  };

  const fbp = cleanText(input.fbp, "", 300);
  const fbc = cleanText(input.fbc, "", 300);

  if (fbp) {
    userData.fbp = fbp;
  }

  if (fbc) {
    userData.fbc = fbc;
  }

  return userData;
}

async function sendMetaCapiClick({ req, input, event }) {
  if (!isMetaCapiConfigured()) {
    return { ok: false, skipped: "not_configured" };
  }

  const pixelId = getMetaPixelId();
  const accessToken = getMetaCapiAccessToken();
  const version = getGraphApiVersion();
  const eventName = getMetaEventName(input, event);
  const eventId = cleanText(input.metaEventId || event.metaEventId || input.event_id || event.event_id, "", 120);

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: getEventSourceUrl(req, input, event),
        user_data: getUserData(req, input),
        custom_data: {
          content_name: cleanText(event.label),
          content_category: "bio_button",
          button_id: cleanText(event.id),
          source_id: cleanText(event.sourceId)
        }
      }
    ]
  };

  if (eventId) {
    payload.data[0].event_id = eventId;
  }

  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = cleanText(process.env.META_TEST_EVENT_CODE, "", 100);
  }

  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(pixelId)}/events`);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = result && result.error ? result.error.message || result.error.code : "unknown_error";
    console.warn(`Meta CAPI request failed: ${response.status} ${error}`);
  }

  return {
    ok: response.ok,
    status: response.status,
    eventName,
    eventId: eventId || null
  };
}

module.exports = {
  getMetaEventName,
  isMetaCapiConfigured,
  sendMetaCapiClick
};
