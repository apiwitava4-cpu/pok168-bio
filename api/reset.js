const { requireAuth } = require("./_lib/auth");
const { resetStats } = require("./_lib/stats");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  try {
    res.status(200).json(await resetStats());
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "server_error" });
  }
};
