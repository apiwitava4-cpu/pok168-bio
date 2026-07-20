const { proxyToBackend } = require("./_lib/proxy");

module.exports = async function handler(req, res) {
  try {
    await proxyToBackend(req, res, "/api/bio-config");
  } catch (error) {
    res.status(error.statusCode || 500).json({ ok: false, error: error.message || "server_error" });
  }
};
