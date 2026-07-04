const { requireAuth } = require("./_lib/auth");
const { getStats } = require("./_lib/stats");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  try {
    res.status(200).json(await getStats());
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "server_error" });
  }
};
