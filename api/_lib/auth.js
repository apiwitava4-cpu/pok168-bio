const crypto = require("crypto");

const sessionCookie = "p9BioSession";

function getDashboardUser() {
  return process.env.DASHBOARD_USER || "admin";
}

function getDashboardPassword() {
  return process.env.DASHBOARD_PASSWORD || "p9bio2026";
}

function getSessionSecret() {
  return process.env.SESSION_SECRET || getDashboardPassword();
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
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

function sign(value) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("hex");
}

function createSessionToken(username) {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const payload = `${username}|${expiresAt}`;
  return `${payload}|${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token) {
    return false;
  }

  const parts = token.split("|");
  if (parts.length !== 3) {
    return false;
  }

  const [username, expiresAt, signature] = parts;
  const payload = `${username}|${expiresAt}`;
  const expected = sign(payload);

  if (signature.length !== expected.length) {
    return false;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false;
  }

  return username === getDashboardUser() && Number(expiresAt) > Date.now();
}

function isAuthenticated(req) {
  return verifySessionToken(parseCookies(req)[sessionCookie]);
}

function setSessionCookie(res, token) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function requireAuth(req, res) {
  if (isAuthenticated(req)) {
    return true;
  }

  res.status(401).json({ ok: false, error: "unauthorized" });
  return false;
}

module.exports = {
  clearSessionCookie,
  createSessionToken,
  getDashboardPassword,
  getDashboardUser,
  isAuthenticated,
  requireAuth,
  setSessionCookie
};
