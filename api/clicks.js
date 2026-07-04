const { recordClick } = require("./_lib/stats");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    res.status(201).json(await recordClick(body, req));
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message || "server_error" });
  }
};
