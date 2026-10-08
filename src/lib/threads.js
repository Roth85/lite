// Server-side conversation memory. Lets thin clients (iOS Shortcuts, the
// Scriptable widget, the /m chat page) carry on a multi-turn conversation by
// sending just `{ message, thread }` — the server keeps the history, so every
// device sharing a thread name sees the same conversation.
//
// Backed by a single JSON file so threads survive restarts. Single-tenant and
// single-process, so synchronous writes are fine.

import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.env.THREADS_FILE || "data/threads.json");
const MAX_MESSAGES = Number(process.env.THREAD_MAX_MESSAGES) || 40;
const THREAD_ID = /^[\w-]{1,64}$/;

/** @type {Record<string, { messages: {role: string, content: string}[], updatedAt: string }>} */
let threads = {};
try {
  threads = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch {
  threads = {};
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(threads, null, 2));
}

export function validThreadId(id) {
  return typeof id === "string" && THREAD_ID.test(id);
}

export function getThread(id) {
  return threads[id]?.messages ?? [];
}

export function resetThread(id) {
  delete threads[id];
  save();
}

/** Append a completed user/assistant exchange and trim to MAX_MESSAGES. */
export function appendExchange(id, userText, assistantText) {
  const messages = [
    ...getThread(id),
    { role: "user", content: userText },
    { role: "assistant", content: assistantText },
  ];
  let trimmed = messages.slice(-MAX_MESSAGES);
  // The Messages API requires the first turn to be the user's.
  while (trimmed.length && trimmed[0].role !== "user") trimmed = trimmed.slice(1);
  threads[id] = { messages: trimmed, updatedAt: new Date().toISOString() };
  save();
}

/** The most recent exchange in a thread, for widgets. */
export function lastExchange(id) {
  const t = threads[id];
  if (!t) return null;
  const msgs = t.messages;
  const answer = msgs.at(-1)?.role === "assistant" ? msgs.at(-1).content : "";
  const question = msgs.findLast((m) => m.role === "user")?.content ?? "";
  return { thread: id, question, answer, updatedAt: t.updatedAt };
}
