const { requireAuth } = require("./_lib/auth");
const { getStats, statsToCsv } = require("./_lib/stats");

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
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="p9-click-stats.csv"');
    res.status(200).send(statsToCsv(await getStats()));
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || "server_error" });
  }
};
