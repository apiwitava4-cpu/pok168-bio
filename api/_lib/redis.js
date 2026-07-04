function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Missing Redis REST environment variables");
  }

  return {
    url: url.replace(/\/+$/, ""),
    token
  };
}

async function redisCommand(command) {
  const { url, token } = getRedisConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const json = await response.json();

  if (!response.ok || json.error) {
    throw new Error(json.error || `Redis request failed: ${response.status}`);
  }

  return json.result;
}

async function redisPipeline(commands) {
  const { url, token } = getRedisConfig();
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands)
  });
  const json = await response.json();

  if (!response.ok || !Array.isArray(json)) {
    throw new Error(`Redis pipeline failed: ${response.status}`);
  }

  json.forEach((item) => {
    if (item && item.error) {
      throw new Error(item.error);
    }
  });

  return json.map((item) => item.result);
}

module.exports = {
  redisCommand,
  redisPipeline
};
