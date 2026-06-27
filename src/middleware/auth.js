// Bearer-token gate. The server is single-tenant (the owner only), so a single
// long random ACCESS_TOKEN is sufficient. Every request must send:
//   Authorization: Bearer <ACCESS_TOKEN>

import crypto from "node:crypto";

const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";

/** Constant-time string compare to avoid leaking the token via timing. */
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function requireAuth(req, res, next) {
  if (!ACCESS_TOKEN) {
    return res
      .status(500)
      .json({ error: "Server misconfigured: ACCESS_TOKEN is not set." });
  }

  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !safeEqual(match[1], ACCESS_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}
