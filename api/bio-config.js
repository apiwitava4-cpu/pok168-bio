const { requireAuth } = require("./_lib/auth");
const { getBioConfig, saveBioConfig } = require("./_lib/bio-config");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      res.status(200).json(await getBioConfig());
      return;
    }

    if (req.method === "POST") {
      if (!requireAuth(req, res)) {
        return;
      }

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      res.status(200).json({ ok: true, config: await saveBioConfig(body) });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message || "server_error" });
  }
};
