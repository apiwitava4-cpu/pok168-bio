const { isAuthenticated } = require("./_lib/auth");

module.exports = function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  res.status(200).json({ ok: true, authenticated: isAuthenticated(req) });
};
