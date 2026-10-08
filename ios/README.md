# COO on your iPhone — Shortcuts, widgets, and a chat window

Four ways to talk to the COO agent from your phone. They all share one
conversation (the server-side thread named **`phone`**), so you can ask from
the Lock Screen, follow up from the widget, and scroll back through it all in
the chat window.

| What | Feels like | Needs |
| --- | --- | --- |
| **A. "Ask COO" Shortcut** | Tap a widget/button → text box pops up over whatever you're doing → answer appears | Shortcuts app (built in) |
| **B. "COO Chat" Shortcut** | Same, but keeps going back and forth until you tap Done | Shortcuts app |
| **C. Scriptable widget** | Home Screen widget showing the latest answer, with **💬 Ask** and **Chat** buttons | [Scriptable](https://scriptable.app) (free) |
| **D. Chat window (`/m`)** | A full iMessage-style chat that lives on your Home Screen like an app | Safari |

> **Why not type straight into the widget?** iOS widgets can't contain text
> fields — not for Shortcuts, not for any app. The closest thing (and what
> everything here does) is: tap the widget → a native text box appears on top
> of the Home Screen → the answer comes back in place. No app switching.

## Server endpoints these use

All need `Authorization: Bearer <ACCESS_TOKEN>`.

| Endpoint | Purpose |
| --- | --- |
| `POST /quick` `{"message": "...", "thread": "phone"}` | Short, plain-text answer; remembers the conversation. Add `"reset": true` to start fresh. `?format=json` returns `{text, thread}`. |
| `GET /last?thread=phone` | Latest `{question, answer, updatedAt}` — for widgets. |
| `GET /threads/phone` · `DELETE /threads/phone` | Read / clear the conversation. |
| `GET /m` | The chat window (no auth on the page itself; it asks for your token once). |

Quick test from a terminal:

```bash
curl https://coo.yourdomain.com/quick \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"message": "What needs my attention today?"}'
```

---

## A. "Ask COO" Shortcut (one question, one answer)

Open **Shortcuts → +** and add these actions in order:

1. **Ask for Input** — Input Type: *Text* · Prompt: `Ask the COO`
2. **Get Contents of URL**
   - URL: `https://coo.yourdomain.com/quick`
   - Method: **POST**
   - Headers: `Authorization` → `Bearer YOUR_ACCESS_TOKEN`
   - Request Body: **JSON** → add field `message` (Text) → *Provided Input* (from step 1)
3. **Show Result** → *Contents of URL*
   *(or **Speak Text** if you want it read aloud — great with Siri/CarPlay)*

Name it **Ask COO**, tap the icon to pick a color/glyph. Then:

- **Home Screen widget:** long-press Home Screen → Edit → Add Widget → **Shortcuts** → pick the 1-button size → choose *Ask COO*.
- **Lock Screen:** long-press Lock Screen → Customize → add the **Shortcuts** widget → *Ask COO*.
- **Control Center (iOS 18+):** open Control Center → + → Add a Control → **Shortcuts** → *Ask COO*.
- **Action Button (15 Pro and later):** Settings → Action Button → Shortcut → *Ask COO*.
- **Back Tap:** Settings → Accessibility → Touch → Back Tap → Double Tap → *Ask COO*.
- **Siri:** "Hey Siri, Ask COO" — Siri reads the prompt and takes your answer by voice.

**Voice-first variant:** replace step 1 with **Dictate Text** (Stop Listening: *After Pause*) and step 3 with **Speak Text**. Hands-free in the truck or on the line.

## B. "COO Chat" Shortcut (back-and-forth)

Duplicate *Ask COO*, then wrap it in a loop:

1. **Repeat** — *100* times
   1. **Ask for Input** — Text · Prompt: `Message the COO` *(leave empty + Done to stop)*
   2. **If** *Provided Input* **does not have any value** → **Stop This Shortcut** → **End If**
   3. **Get Contents of URL** — same as A.2
   4. **Show Result** → *Contents of URL*
2. **End Repeat**

Because the server remembers the `phone` thread, each turn already knows the
earlier ones — no need to pass history around in the Shortcut.

**"New conversation" Shortcut:** one action — **Get Contents of URL** to
`https://coo.yourdomain.com/threads/phone`, Method **DELETE**, same
`Authorization` header. Put it in the same 2×2 Shortcuts widget as Ask/Chat.

### Recommended widget layout

Add the **Shortcuts** widget in the **medium** size and choose a folder holding:
`Ask COO` · `COO Chat` · `COO Voice` · `New COO Chat` — four buttons in one
widget.

### Optional Shortcut add-ons

- **Ask about what's on screen:** turn on *Show in Share Sheet* (Shortcut ⓘ → Details), accept *Text, URLs, Images*. Use **Combine Text** to build `"<your question>\n\n<Shortcut Input>"` as the `message`.
- **Separate threads per business:** add a `thread` field to the JSON body (e.g. `maumee`, `musgrove`) and make one Shortcut per entity.
- **Morning brief automation:** Shortcuts → Automation → Time of Day 7:00 → run a Shortcut that sends `Give me my morning brief` with `"thread": "brief"` and `"reset": true`, then **Show Notification** with the result.

## C. Scriptable widget (shows the latest answer + Ask/Chat buttons)

1. Install **Scriptable** from the App Store.
2. Open it → **+** → paste [`scriptable/COO.js`](scriptable/COO.js) → name the script **COO**.
3. Tap ▶︎ once — enter your server URL and token (stored in the iOS Keychain).
   You'll see a widget preview, then a chat prompt.
4. Home Screen → Edit → Add Widget → **Scriptable** → **Medium** (or Large) →
   tap the placed widget → Script: **COO** · When Interacting: **Run Script**.

What you get:

- The widget shows your last question and the COO's answer, refreshed about every 15 minutes.
- **💬 Ask** opens a text box (with a **🎤 Speak** option); the answer comes back with **Reply / Open full chat / Copy answer**.
- **Chat** opens the full `/m` chat window.
- **Small** widget: the whole thing is an Ask button. **Lock Screen** (rectangular/circular): "Ask COO" tap target.
- **Widget Parameter**: set it to a thread name (e.g. `maumee`) to give that widget its own conversation.
- **From Shortcuts**: the Scriptable "Run Script" action with text input sends that text and returns the answer as the Shortcut's output.
- To change the URL/token later, open `scriptable:///run/COO?action=setup`.

## D. Chat window on your Home Screen (`/m`)

1. In **Safari**, open `https://coo.yourdomain.com/m`.
2. Paste your `ACCESS_TOKEN` once (kept in that browser's storage on your phone only).
3. **Share → Add to Home Screen.** It launches full-screen like an app.

It streams answers as they're written, shows the whole `phone` thread (including
anything you asked from the Shortcuts or widget), and **New** clears it. Use
`/m?thread=maumee` for a separate conversation.

## Security notes

- Your token lives in the Shortcut, the iOS Keychain (Scriptable), or Safari
  storage. Anyone holding it can talk to your COO — don't share the Shortcut
  file without removing the token first.
- Always use the HTTPS URL (see `deploy/nginx.conf.example`).
- Conversations are saved on the server in `data/threads.json` (gitignored;
  override with `THREADS_FILE`). Only the most recent 40 messages per thread are
  kept (`THREAD_MAX_MESSAGES`).
