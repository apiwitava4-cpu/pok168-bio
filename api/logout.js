const { clearSessionCookie } = require("./_lib/auth");

module.exports = function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  clearSessionCookie(res);
  res.status(200).json({ ok: true });
};
