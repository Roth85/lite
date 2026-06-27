// Toast POS integration for Maumee Street. Pulls LIVE order-level data (not a
// canned report) and aggregates today's net sales, order count, and item mix.
// TTL-cached.
//
// Toast auth is a client-credentials exchange: POST clientId/clientSecret to
// /authentication/v1/authentication/login -> bearer token, then call the
// Orders API with that token + the restaurant GUID header.
//
// If the Toast env vars are blank, Toast is treated as disabled and the
// helpers return empty results instead of throwing.

import { cached } from "../lib/cache.js";

const {
  TOAST_CLIENT_ID,
  TOAST_CLIENT_SECRET,
  TOAST_RESTAURANT_GUID,
  TOAST_API_HOST = "https://ws-api.toasttab.com",
  // IANA tz for the restaurant, so "today's business date" is computed in
  // local time rather than UTC. Defaults to US Eastern.
  TOAST_TIMEZONE = "America/New_York",
} = process.env;

export function toastEnabled() {
  return Boolean(
    TOAST_CLIENT_ID && TOAST_CLIENT_SECRET && TOAST_RESTAURANT_GUID,
  );
}

async function getAccessToken() {
  return cached(
    "toast:token",
    async () => {
      const res = await fetch(
        `${TOAST_API_HOST}/authentication/v1/authentication/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: TOAST_CLIENT_ID,
            clientSecret: TOAST_CLIENT_SECRET,
            userAccessType: "TOAST_MACHINE_CLIENT",
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`Toast auth failed: ${res.status} ${await res.text()}`);
      }
      const json = await res.json();
      return json.token?.accessToken;
    },
    10 * 60 * 1000, // Toast tokens are short-lived.
  );
}

async function toastGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${TOAST_API_HOST}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Toast-Restaurant-External-ID": TOAST_RESTAURANT_GUID,
    },
  });
  if (!res.ok) {
    throw new Error(`Toast ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Toast businessDate is YYYYMMDD in the restaurant's local time. */
function businessDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TOAST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts.replace(/-/g, ""); // "2026-06-27" -> "20260627"
}

/**
 * Pull today's live orders and aggregate. Reads the Orders API directly so the
 * numbers are real-time, not a pre-generated report. Bounded to a few pages so
 * a very busy day can't blow the request up.
 */
export async function loadToastSnapshot() {
  if (!toastEnabled()) return null;

  return cached("toast:snapshot", async () => {
    try {
      const date = businessDate();
      let netSales = 0;
      let orderCount = 0;
      const itemCounts = new Map(); // displayName -> qty

      for (let page = 1; page <= 5; page++) {
        const orders = await toastGet(
          `/orders/v2/ordersBulk?businessDate=${date}&page=${page}&pageSize=100`,
        );
        if (!Array.isArray(orders) || orders.length === 0) break;

        for (const order of orders) {
          orderCount += 1;
          for (const check of order.checks || []) {
            // Toast check amounts are decimal dollars.
            netSales += Number(check.totalAmount ?? check.amount ?? 0);
            for (const sel of check.selections || []) {
              const name = sel.displayName || sel.itemName || "Unknown";
              itemCounts.set(
                name,
                (itemCounts.get(name) || 0) + Number(sel.quantity || 1),
              );
            }
          }
        }
        if (orders.length < 100) break; // last page
      }

      const topItems = [...itemCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, qty]) => ({ name, qty }));

      return {
        businessDate: date,
        orderCount,
        netSales: Math.round(netSales * 100) / 100,
        topItems,
      };
    } catch (err) {
      return { error: err.message };
    }
  });
}

/** Render the live Toast snapshot as a context block for the system prompt. */
export async function toastContextBlock() {
  const snap = await loadToastSnapshot();
  if (!snap) return "";
  if (snap.error) {
    return `## Toast (Maumee Street — LIVE)\nFeed unavailable: ${snap.error}. Do not estimate sales; say the live figure isn't loaded.`;
  }
  const items = snap.topItems.length
    ? snap.topItems.map((i) => `${i.name} ×${i.qty}`).join(", ")
    : "no items yet";
  return `## Toast (Maumee Street — LIVE, business date ${snap.businessDate})
Net sales so far today: $${snap.netSales.toFixed(2)} across ${snap.orderCount} orders.
Top items today: ${items}.
These are live order-level figures. For anything not shown here, say the live figure isn't loaded rather than estimating.`;
}
