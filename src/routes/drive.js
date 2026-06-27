// Google Drive document backbone. Reads text-extractable docs from the
// configured entity folders and returns their contents so they can be injected
// into the agent's context. Results are TTL-cached (see lib/cache.js).
//
// Auth: an OAuth client with a long-lived refresh token (see README). If the
// Google env vars are blank, Drive is treated as disabled and these helpers
// return empty results instead of throwing.

import { google } from "googleapis";
import { cached } from "../lib/cache.js";

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_DRIVE_FOLDER_IDS,
} = process.env;

export function driveEnabled() {
  return Boolean(
    GOOGLE_CLIENT_ID &&
      GOOGLE_CLIENT_SECRET &&
      GOOGLE_REFRESH_TOKEN &&
      GOOGLE_DRIVE_FOLDER_IDS,
  );
}

function folderIds() {
  return (GOOGLE_DRIVE_FOLDER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeDriveClient() {
  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth: oauth2 });
}

// MIME types we can pull as plain text. Google-native docs are exported;
// plain text/markdown are downloaded directly.
const EXPORTABLE = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};
const DOWNLOADABLE = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

async function readFileText(drive, file) {
  try {
    if (EXPORTABLE[file.mimeType]) {
      const res = await drive.files.export(
        { fileId: file.id, mimeType: EXPORTABLE[file.mimeType] },
        { responseType: "text" },
      );
      return String(res.data);
    }
    if (DOWNLOADABLE.has(file.mimeType)) {
      const res = await drive.files.get(
        { fileId: file.id, alt: "media" },
        { responseType: "text" },
      );
      return String(res.data);
    }
  } catch (err) {
    return `[unreadable: ${err.message}]`;
  }
  return null; // unsupported type — skipped
}

/**
 * List + read all text-extractable docs across the configured folders.
 * Returns [{ name, mimeType, text }]. Truncates each doc to keep the prompt
 * bounded; raise the cap if you need fuller documents.
 */
export async function loadDriveDocs({ maxCharsPerDoc = 8000 } = {}) {
  if (!driveEnabled()) return [];

  return cached("drive:docs", async () => {
    const drive = makeDriveClient();
    const docs = [];

    for (const folderId of folderIds()) {
      const list = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "files(id, name, mimeType)",
        pageSize: 100,
      });

      for (const file of list.data.files || []) {
        const text = await readFileText(drive, file);
        if (text == null) continue;
        docs.push({
          name: file.name,
          mimeType: file.mimeType,
          text: text.slice(0, maxCharsPerDoc),
        });
      }
    }
    return docs;
  });
}

/** Render Drive docs as a context block for the system prompt. */
export async function driveContextBlock() {
  const docs = await loadDriveDocs();
  if (!docs.length) return "";
  const body = docs
    .map((d) => `### ${d.name}\n${d.text}`)
    .join("\n\n---\n\n");
  return `## Live documents (Google Drive)\n${body}`;
}
