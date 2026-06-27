// Toast POS integration for Maumee Street. Pulls live sales/labor data via
// Toast's API and renders it into a context block. TTL-cached.
//
// Toast auth is a client-credentials exchange: POST clientId/clientSecret to
// /authentication/v1/authentication/login -> bearer token, then call the
// analytics/orders endpoints with that token + the restaurant GUID header.
//
// If the Toast env vars are blank, Toast is treated as disabled and the
// helpers return empty results instead of throwing.

import { cached } from "../lib/cache.js";

const {
  TOAST_CLIENT_ID,
  TOAST_CLIENT_SECRET,
  TOAST_RESTAURANT_GUID,
  TOAST_API_HOST = "https://ws-api.toasttab.com",
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
    // Toast tokens are short-lived; cache for 10 min regardless of the
    // global TTL.
    10 * 60 * 1000,
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

/**
 * Pull a lightweight live snapshot. Endpoints/fields vary by Toast plan and
 * API version — adjust the paths to the ones enabled for this restaurant.
 * Returns null on failure so the agent degrades gracefully.
 */
export async function loadToastSnapshot() {
  if (!toastEnabled()) return null;

  return cached("toast:snapshot", async () => {
    try {
      // Restaurant config confirms connectivity and names the venue.
      const config = await toastGet(
        `/restaurants/v1/restaurants/${TOAST_RESTAURANT_GUID}`,
      );
      return {
        restaurantName: config?.general?.name ?? "Maumee Street Taproom",
        fetchedFrom: TOAST_API_HOST,
        // NOTE: sales-mix / labor pulls go here once the specific reporting
        // endpoints for this account are confirmed. Left as connectivity-only
        // so the agent never reports fabricated numbers.
      };
    } catch (err) {
      return { error: err.message };
    }
  });
}

/** Render the Toast snapshot as a context block for the system prompt. */
export async function toastContextBlock() {
  const snap = await loadToastSnapshot();
  if (!snap) return "";
  if (snap.error) {
    return `## Toast (Maumee Street POS)\nFeed unavailable: ${snap.error}`;
  }
  return `## Toast (Maumee Street POS)\nConnected: ${snap.restaurantName} via ${snap.fetchedFrom}. Use Toast sales/labor data for financial questions; do not estimate when the live figure isn't loaded.`;
}
