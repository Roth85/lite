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
import {
  appendExchange,
  getThread,
  lastExchange,
  resetThread,
  validThreadId,
} from "../lib/threads.js";

const router = express.Router();
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

/**
 * Build the system prompt as cache-friendly blocks. The durable master
 * context is byte-stable and goes first (cached). Live Drive/Toast blocks go
 * after — they change as data refreshes, but the master prefix stays warm.
 */
async function buildSystem({ brief = false } = {}) {
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

  // Phone surfaces (Shortcuts alerts, Siri, widgets) need short answers. This
  // goes after the cache breakpoint so it doesn't disturb the cached prefix.
  if (brief) {
    blocks.push({
      type: "text",
      text:
        "The owner is on their phone (iOS Shortcut, Siri, or widget). Answer " +
        "in a few short sentences of plain text — no markdown, tables, or " +
        "headings — unless they explicitly ask for detail.",
    });
  }
  return blocks;
}

/**
 * Normalize incoming messages to the Anthropic shape. Accepts either a single
 * `message` string or a full `messages` array (multi-turn from the client).
 * With `message` + `thread`, the server-side history for that thread is
 * prepended (and `reset: true` starts the thread over first).
 */
function normalizeMessages(body) {
  if (body.thread !== undefined && !validThreadId(body.thread)) return null;
  if (Array.isArray(body.messages) && body.messages.length) {
    return body.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));
  }
  if (typeof body.message === "string" && body.message.trim()) {
    const history = body.thread && !body.reset ? getThread(body.thread) : [];
    return [...history, { role: "user", content: body.message }];
  }
  return null;
}

/** After a reply, record the exchange if the caller is using a thread. */
function remember(body, text) {
  if (!body.thread || typeof body.message !== "string" || !text) return;
  if (body.reset) resetThread(body.thread);
  appendExchange(body.thread, body.message, text);
}

/** Run a non-streaming completion and return the reply text. */
async function complete(messages, { brief = false } = {}) {
  const system = await buildSystem({ brief });
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: brief ? 4000 : 64000,
    thinking: { type: "adaptive" },
    system,
    messages,
  });
  const final = await stream.finalMessage();
  const text = final.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, final };
}

// POST /chat  — streaming Server-Sent Events.
// Body: { message: string, thread?, reset? } OR { messages: [{role, content}, ...] }
router.post("/chat", async (req, res) => {
  const messages = normalizeMessages(req.body);
  if (!messages) {
    return res
      .status(400)
      .json({ error: "Provide `message` or `messages` (and a valid `thread`)." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const system = await buildSystem({ brief: Boolean(req.body.brief) });

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system,
      messages,
    });

    let text = "";
    stream.on("text", (delta) => {
      text += delta;
      send("text", { delta });
    });

    const final = await stream.finalMessage();
    remember(req.body, text);
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
    return res
      .status(400)
      .json({ error: "Provide `message` or `messages` (and a valid `thread`)." });
  }
  try {
    const { text, final } = await complete(messages, {
      brief: Boolean(req.body.brief),
    });
    remember(req.body, text);
    res.json({ text, stop_reason: final.stop_reason, usage: final.usage });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /quick — built for iOS Shortcuts / Siri / widgets. Replies in plain
// text (so a Shortcut can just "Show Result" or "Speak Text"), keeps short
// answers, and remembers the conversation in a thread (default "phone").
// Body: { message, thread?: "phone", reset?: false, brief?: true }
// Add `?format=json` to get { text, thread } instead of plain text.
router.post("/quick", async (req, res) => {
  const body = { brief: true, ...req.body, thread: req.body?.thread || "phone" };
  const messages = normalizeMessages(body);
  if (!messages) {
    return res
      .status(400)
      .type("text/plain")
      .send("Say something first (send a `message`).");
  }
  try {
    const { text } = await complete(messages, { brief: body.brief !== false });
    remember(body, text);
    if (req.query.format === "json") return res.json({ text, thread: body.thread });
    res.type("text/plain").send(text);
  } catch (err) {
    res.status(502).type("text/plain").send(`COO is unavailable: ${err.message}`);
  }
});

// GET /last?thread=phone — the latest question/answer, for home-screen widgets.
router.get("/last", (req, res) => {
  const thread = req.query.thread || "phone";
  if (!validThreadId(thread)) return res.status(400).json({ error: "Bad thread." });
  res.json(
    lastExchange(thread) ?? { thread, question: "", answer: "", updatedAt: null },
  );
});

// GET /threads/:id — full history (the /m chat page loads this on open).
router.get("/threads/:id", (req, res) => {
  if (!validThreadId(req.params.id)) return res.status(400).json({ error: "Bad thread." });
  res.json({ thread: req.params.id, messages: getThread(req.params.id) });
});

// DELETE /threads/:id — start a thread over.
router.delete("/threads/:id", (req, res) => {
  if (!validThreadId(req.params.id)) return res.status(400).json({ error: "Bad thread." });
  resetThread(req.params.id);
  res.json({ ok: true });
});

export default router;
