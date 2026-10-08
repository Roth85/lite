// COO widget + quick chat for iPhone, built for the free Scriptable app
// (https://scriptable.app). One script does two jobs:
//
//   • On the Home Screen (as a widget) it shows the COO's latest answer with
//     two buttons: "Ask" (pops a text box, keeps the conversation going) and
//     "Chat" (opens the full /m chat window).
//   • Run in the app (or from the "Ask" button / a Shortcut / Siri) it opens a
//     back-and-forth chat in native iOS prompts, with an optional mic button.
//
// It talks to the COO agent server's /quick and /last endpoints on the
// "phone" thread — the same conversation the iOS Shortcuts and /m page use.
//
// Setup: paste this into a new Scriptable script named "COO", run it once,
// and enter your server URL + ACCESS_TOKEN (saved in the iOS Keychain).
// Widget parameter (optional): a different thread name, e.g. "maumee".

const THREAD = (args.widgetParameter || args.queryParameters.thread || "phone").trim();
const KEY_HOST = "coo_host";
const KEY_TOKEN = "coo_token";

// ── Config ────────────────────────────────────────────────────────────────

async function ensureConfig(force = false) {
  if (!force && Keychain.contains(KEY_HOST) && Keychain.contains(KEY_TOKEN)) {
    return { host: Keychain.get(KEY_HOST), token: Keychain.get(KEY_TOKEN) };
  }
  if (config.runsInWidget) return null;

  const a = new Alert();
  a.title = "Connect to your COO";
  a.message = "Server URL (e.g. https://coo.yourdomain.com) and your ACCESS_TOKEN.";
  a.addTextField("https://coo.yourdomain.com", Keychain.contains(KEY_HOST) ? Keychain.get(KEY_HOST) : "");
  a.addSecureTextField("Access token", "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if ((await a.presentAlert()) === -1) return null;

  const host = a.textFieldValue(0).trim().replace(/\/+$/, "");
  const token = a.textFieldValue(1).trim();
  Keychain.set(KEY_HOST, host);
  Keychain.set(KEY_TOKEN, token);
  return { host, token };
}

// ── API ───────────────────────────────────────────────────────────────────

async function call(cfg, method, path, body) {
  const req = new Request(cfg.host + path);
  req.method = method;
  req.timeoutInterval = 120;
  req.headers = { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" };
  if (body) req.body = JSON.stringify(body);
  const json = await req.loadJSON();
  const status = req.response?.statusCode;
  if (status === 401) throw new Error("Unauthorized — check your access token.");
  if (status >= 400) throw new Error(json.error || `Server error (${status}).`);
  return json;
}

const ask = (cfg, message) =>
  call(cfg, "POST", "/quick?format=json", { message, thread: THREAD }).then((r) => r.text);

const last = (cfg) => call(cfg, "GET", `/last?thread=${encodeURIComponent(THREAD)}`);

// ── In-app chat loop ──────────────────────────────────────────────────────

async function prompt(title, message) {
  const a = new Alert();
  a.title = title;
  if (message) a.message = message;
  a.addTextField("Message the COO", "");
  a.addAction("Send");
  a.addAction("🎤 Speak");
  a.addCancelAction("Cancel");
  const choice = await a.presentAlert();
  if (choice === -1) return null;
  if (choice === 1) return (await Dictation.start()).trim() || null;
  return a.textFieldValue(0).trim() || null;
}

async function chatLoop(cfg) {
  let text = await prompt("Ask the COO");
  while (text) {
    let answer;
    try {
      answer = await ask(cfg, text);
    } catch (e) {
      answer = `⚠️ ${e.message}`;
    }

    const a = new Alert();
    a.title = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    a.message = answer;
    a.addAction("Reply");
    a.addAction("Open full chat");
    a.addAction("Copy answer");
    a.addCancelAction("Done");
    const choice = await a.presentSheet();

    if (choice === 0) text = await prompt("Reply");
    else if (choice === 1) { Safari.open(`${cfg.host}/m?thread=${encodeURIComponent(THREAD)}`); text = null; }
    else if (choice === 2) { Pasteboard.copyString(answer); text = null; }
    else text = null;
  }
}

// ── Widget ────────────────────────────────────────────────────────────────

function runUrl(params) {
  const q = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `${URLScheme.forRunningScript()}?${q}`;
}

function button(stack, label, url) {
  const b = stack.addStack();
  b.backgroundColor = new Color("#1f6feb");
  b.cornerRadius = 10;
  b.setPadding(5, 12, 5, 12);
  b.url = url;
  const t = b.addText(label);
  t.font = Font.semiboldSystemFont(13);
  t.textColor = Color.white();
}

async function buildWidget(cfg) {
  const family = config.widgetFamily || "medium";
  const w = new ListWidget();
  const askUrl = runUrl({ action: "ask", thread: THREAD });
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  // Lock Screen widgets: just a tap target.
  if (family.startsWith("accessory")) {
    const t = w.addText(family === "accessoryCircular" ? "COO" : "💬 Ask COO");
    t.font = Font.semiboldSystemFont(13);
    t.centerAlignText();
    w.url = askUrl;
    return w;
  }

  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1d20"));
  w.setPadding(12, 14, 12, 14);
  const fg = Color.dynamic(new Color("#17181a"), new Color("#ececec"));
  const muted = Color.dynamic(new Color("#6b6e73"), new Color("#9a9ca1"));

  const title = w.addText("COO");
  title.font = Font.boldSystemFont(14);
  title.textColor = fg;
  w.addSpacer(4);

  let data = null;
  try {
    data = cfg ? await last(cfg) : null;
  } catch (e) {
    data = { question: "", answer: `⚠️ ${e.message}` };
  }

  if (data?.question && family !== "small") {
    const q = w.addText(`You: ${data.question}`);
    q.font = Font.systemFont(11);
    q.textColor = muted;
    q.lineLimit = 1;
    w.addSpacer(2);
  }

  const answer = w.addText(
    !cfg ? "Tap to connect." : data?.answer || "No conversation yet — tap Ask.",
  );
  answer.font = Font.systemFont(family === "small" ? 12 : 13);
  answer.textColor = fg;
  answer.lineLimit = family === "large" ? 18 : family === "small" ? 5 : 4;
  w.addSpacer();

  // Small widgets only support one tap target — the whole widget asks.
  if (family === "small") {
    w.url = askUrl;
    return w;
  }

  const row = w.addStack();
  row.centerAlignContent();
  button(row, "💬 Ask", askUrl);
  row.addSpacer(8);
  if (cfg) button(row, "Chat", `${cfg.host}/m?thread=${encodeURIComponent(THREAD)}`);
  row.addSpacer();
  const time = row.addDate(new Date());
  time.applyTimeStyle();
  time.font = Font.systemFont(10);
  time.textColor = muted;
  return w;
}

// ── Entry point ───────────────────────────────────────────────────────────

if (config.runsInWidget) {
  const cfg = await ensureConfig();
  Script.setWidget(await buildWidget(cfg));
} else if (args.queryParameters.action === "setup") {
  await ensureConfig(true);
} else {
  const cfg = await ensureConfig();
  if (cfg) {
    // Text passed in from a Shortcut ("Run Script" with input) skips the prompt.
    const fromShortcut = args.shortcutParameter;
    if (typeof fromShortcut === "string" && fromShortcut.trim()) {
      const answer = await ask(cfg, fromShortcut.trim());
      Script.setShortcutOutput(answer);
    } else if (config.runsInApp && !args.queryParameters.action) {
      // Opened directly in Scriptable: preview the widget, then chat.
      await (await buildWidget(cfg)).presentMedium();
      await chatLoop(cfg);
    } else {
      await chatLoop(cfg);
    }
  }
}
Script.complete();
