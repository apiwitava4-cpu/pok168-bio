const {
  createSessionToken,
  getDashboardPassword,
  getDashboardUser,
  setSessionCookie
} = require("./_lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    if (body.username === getDashboardUser() && body.password === getDashboardPassword()) {
      setSessionCookie(res, createSessionToken(getDashboardUser()));
      res.status(200).json({ ok: true });
      return;
    }

    res.status(401).json({ ok: false, error: "invalid_credentials" });
  } catch (error) {
    res.status(400).json({ ok: false, error: "invalid_json" });
  }
};
