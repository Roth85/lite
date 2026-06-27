// COO Agent Server — always-on relay.
//
// Every request is authenticated, then routed to the chat relay, which injects
// the full business context (master context + live Drive + Toast) into the
// conversation before calling Claude. Point the dashboard / mobile client at
// this server and the agent has total recall from any device.

import "dotenv/config";
import express from "express";
import { requireAuth } from "./middleware/auth.js";
import chatRouter from "./routes/chat.js";
import { driveEnabled } from "./routes/drive.js";
import { toastEnabled } from "./routes/toast.js";
import { squareEnabled } from "./routes/square.js";
import { invalidate } from "./lib/cache.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Health check — unauthenticated, so uptime monitors can hit it.
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
    feeds: {
      drive: driveEnabled(),
      toast: toastEnabled(),
      square: squareEnabled(),
    },
  });
});

// Everything below requires the bearer token.
app.use(requireAuth);

// Force a refresh of cached Drive/Toast pulls (e.g. after dropping a new doc).
app.post("/refresh", (_req, res) => {
  invalidate();
  res.json({ ok: true });
});

app.use(chatRouter);

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, () => {
  console.log(`COO agent server listening on :${PORT}`);
  console.log(`  drive feed:  ${driveEnabled() ? "on" : "off"}`);
  console.log(`  toast feed:  ${toastEnabled() ? "on" : "off"}`);
  console.log(`  square feed: ${squareEnabled() ? "on" : "off"}`);
});
