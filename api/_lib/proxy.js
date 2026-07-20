const defaultBackendUrl = "https://pok168-bio.onrender.com";

function getBackendBaseUrl() {
  return String(process.env.P9_BACKEND_URL || defaultBackendUrl).replace(/\/+$/, "");
}

function getRequestQuery(req) {
  const rawUrl = String(req.url || "");
  const queryStart = rawUrl.indexOf("?");
  return queryStart === -1 ? "" : rawUrl.slice(queryStart);
}

function pickRequestHeaders(req) {
  const headers = {};
  [
    "accept",
    "accept-language",
    "content-type",
    "cookie",
    "user-agent",
    "x-forwarded-for",
    "x-real-ip"
  ].forEach((name) => {
    if (req.headers[name]) {
      headers[name] = req.headers[name];
    }
  });
  return headers;
}

function readRawBody(req) {
  if (Buffer.isBuffer(req.body) || typeof req.body === "string") {
    return Promise.resolve(req.body);
  }

  if (req.body && typeof req.body === "object") {
    return Promise.resolve(JSON.stringify(req.body));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const cookie = headers.get("set-cookie");
  return cookie ? [cookie] : [];
}

async function proxyToBackend(req, res, targetPath) {
  const url = `${getBackendBaseUrl()}${targetPath}${getRequestQuery(req)}`;
  const method = String(req.method || "GET").toUpperCase();
  const headers = pickRequestHeaders(req);
  const body = method === "GET" || method === "HEAD" ? undefined : await readRawBody(req);

  if (body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: "manual"
  });

  res.statusCode = response.status;
  ["content-type", "content-disposition", "cache-control", "location"].forEach((name) => {
    const value = response.headers.get(name);
    if (value) {
      res.setHeader(name, value);
    }
  });

  const cookies = getSetCookieHeaders(response.headers);
  if (cookies.length) {
    res.setHeader("Set-Cookie", cookies);
  }

  if (method === "HEAD") {
    res.end();
    return;
  }

  const payload = Buffer.from(await response.arrayBuffer());
  res.end(payload);
}

module.exports = {
  proxyToBackend
};
