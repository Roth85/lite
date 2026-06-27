// The chat relay. Assembles the full operating context (master context +
// live Drive docs + Toast snapshot) into a cached system prompt, then calls
// Claude. This is what makes every conversation — from any device — start
// with the agent already knowing everything about the business.

import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { renderMasterContext } from "../context/masterContext.js";
import { driveContextBlock, driveEnabled } from "./drive.js";
import { toastContextBlock, toastEnabled } from "./toast.js";
import { squareContextBlock, squareEnabled } from "./square.js";

const router = express.Router();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

/**
 * Build the system prompt as cache-friendly blocks. The durable master
 * context is byte-stable and goes first (cached). Live Drive/Toast blocks go
 * after — they change as data refreshes, but the master prefix stays warm.
 */
async function buildSystem() {
  const blocks = [{ type: "text", text: renderMasterContext() }];

  const [drive, toast, square] = await Promise.all([
    driveEnabled() ? driveContextBlock() : Promise.resolve(""),
    toastEnabled() ? toastContextBlock() : Promise.resolve(""),
    squareEnabled() ? squareContextBlock() : Promise.resolve(""),
  ]);

  const live = [toast, square, drive].filter(Boolean).join("\n\n");
  if (live) blocks.push({ type: "text", text: live });

  // Cache the whole system prefix (master + live). The 20-block lookback and
  // prefix-match rules mean the master context is reused across turns even as
  // the live block changes only occasionally.
  blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
  return blocks;
}

/**
 * Normalize incoming messages to the Anthropic shape. Accepts either a single
 * `message` string or a full `messages` array (multi-turn from the client).
 */
function normalizeMessages(body) {
  if (Array.isArray(body.messages) && body.messages.length) {
    return body.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
  }
  if (typeof body.message === "string" && body.message.trim()) {
    return [{ role: "user", content: body.message }];
  }
  return null;
}

// POST /chat  — streaming Server-Sent Events.
// Body: { message: string } OR { messages: [{role, content}, ...] }
router.post("/chat", async (req, res) => {
  const messages = normalizeMessages(req.body);
  if (!messages) {
    return res.status(400).json({ error: "Provide `message` or `messages`." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const system = await buildSystem();

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system,
      messages,
    });

    stream.on("text", (delta) => send("text", { delta }));

    const final = await stream.finalMessage();
    send("done", {
      stop_reason: final.stop_reason,
      usage: final.usage,
      model: final.model,
    });
  } catch (err) {
    send("error", { message: err.message });
  } finally {
    res.end();
  }
});

// POST /chat/sync — non-streaming JSON, for callers that don't speak SSE.
router.post("/chat/sync", async (req, res) => {
  const messages = normalizeMessages(req.body);
  if (!messages) {
    return res.status(400).json({ error: "Provide `message` or `messages`." });
  }
  try {
    const system = await buildSystem();
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system,
      messages,
    });
    const final = await stream.finalMessage();
    const text = final.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    res.json({ text, stop_reason: final.stop_reason, usage: final.usage });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
