// Square integration for Musgrove + Company. Pulls LIVE payments (not a
// report) and aggregates today's sales total. TTL-cached.
//
// Square auth is a single access token (Bearer). All calls send a pinned
// Square-Version header. If the Square env vars are blank, Square is treated
// as disabled and the helpers return empty results instead of throwing.

import { cached } from "../lib/cache.js";

const {
  SQUARE_ACCESS_TOKEN,
  SQUARE_API_HOST = "https://connect.squareup.com",
  SQUARE_LOCATION_ID, // optional; if set, filters to that location
  SQUARE_VERSION = "2024-12-18",
  SQUARE_TIMEZONE = "America/New_York",
} = process.env;

export function squareEnabled() {
  return Boolean(SQUARE_ACCESS_TOKEN);
}

async function squareGet(path) {
  const res = await fetch(`${SQUARE_API_HOST}${path}`, {
    headers: {
      Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Square ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Start of today (local tz) as an RFC 3339 timestamp for begin_time. */
function startOfTodayISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SQUARE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // Square accepts RFC 3339; midnight UTC of the local date is close enough
  // for a daily total and avoids tz-offset math here. Adjust if you need
  // exact local-midnight boundaries.
  return `${parts}T00:00:00Z`;
}

/**
 * Pull today's completed payments and aggregate. Reads the Payments API
 * directly so figures are live. Bounded to a few pages.
 */
export async function loadSquareSnapshot() {
  if (!squareEnabled()) return null;

  return cached("square:snapshot", async () => {
    try {
      const begin = encodeURIComponent(startOfTodayISO());
      const loc = SQUARE_LOCATION_ID
        ? `&location_id=${SQUARE_LOCATION_ID}`
        : "";

      let grossCents = 0;
      let paymentCount = 0;
      let cursor = "";

      for (let page = 0; page < 5; page++) {
        const c = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const json = await squareGet(
          `/v2/payments?begin_time=${begin}&sort_order=DESC${loc}${c}`,
        );
        for (const p of json.payments || []) {
          if (p.status && p.status !== "COMPLETED") continue;
          grossCents += Number(p.amount_money?.amount || 0);
          paymentCount += 1;
        }
        cursor = json.cursor || "";
        if (!cursor) break;
      }

      return {
        sinceISO: startOfTodayISO(),
        paymentCount,
        grossSales: Math.round(grossCents) / 100, // cents -> dollars
      };
    } catch (err) {
      return { error: err.message };
    }
  });
}

/** Render the live Square snapshot as a context block for the system prompt. */
export async function squareContextBlock() {
  const snap = await loadSquareSnapshot();
  if (!snap) return "";
  if (snap.error) {
    return `## Square (Musgrove + Company — LIVE)\nFeed unavailable: ${snap.error}. Do not estimate sales; say the live figure isn't loaded.`;
  }
  return `## Square (Musgrove + Company — LIVE)
Payments since ${snap.sinceISO}: $${snap.grossSales.toFixed(2)} across ${snap.paymentCount} payments.
These are live payment figures. For anything not shown here, say the live figure isn't loaded rather than estimating.`;
}
