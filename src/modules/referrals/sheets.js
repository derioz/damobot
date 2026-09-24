import {
  createSignedGoogleJwt,
  getGoogleAccessToken,
  clearTokenCache,
  getSheetNumericId,
} from "../../shared/googleSheets.js";
import { referralConfig } from "../../config/referral.config.js";

export { createSignedGoogleJwt, getGoogleAccessToken, clearTokenCache };

/**
 * Format a Discord ISO timestamp (joined_at) to MM/DD/YYYY.
 * Returns "Unknown" if missing or invalid.
 */
export function formatJoinDate(joinedAt) {
  if (!joinedAt) return "Unknown";
  try {
    const d = new Date(joinedAt);
    if (isNaN(d.getTime())) return "Unknown";
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const year = d.getUTCFullYear();
    return `${month}/${day}/${year}`;
  } catch {
    return "Unknown";
  }
}

/**
 * Format the full cell note string for the join date.
 */
export function formatJoinDateNote(joinedAt) {
  const formatted = formatJoinDate(joinedAt);
  return `Joined Vital RP Discord: ${formatted}`;
}

/**
 * Submits a referral to Google Sheets after verifying no duplicate exists in column C.
 * Writes strictly to columns A-E of the first available blank row, and adds a cell note
 * with the player's Discord join date to Column B without overwriting other cell properties.
 */
export async function submitReferralToSheet({
  env,
  referredPlayerName,
  referredPlayerId,
  referredByName,
  referredById,
  joinedAt,
  customFetch = fetch,
}) {
  const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId =
    env.GOOGLE_SHEET_ID ||
    referralConfig.settings?.sheetId ||
    "1pMPhLNXdLGSPCVvy_ZKZyU6OkTWP6wZBC-s_f310_xM";
  const sheetTab =
    env.GOOGLE_SHEET_TAB ||
    referralConfig.settings?.sheetTab ||
    "Referral Tracker";

  if (!serviceAccountEmail || !privateKey) {
    throw new Error("Missing Google Service Account credentials (GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY)");
  }

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  // 1. Fetch existing rows across columns A:E
  const readRange = `${sheetTab}!A:E`;
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(readRange)}`;

  const getRes = await customFetch(getUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!getRes.ok) {
    const errorText = await getRes.text();
    throw new Error(`Failed to read sheet data with status ${getRes.status}: ${errorText}`);
  }

  const data = await getRes.json();
  const rows = data.values || [];

  // 2. Search Column C (index 2) for the submitting user's Discord ID (if duplicate prevention enabled)
  const shouldPreventDuplicates =
    referralConfig.settings?.preventDuplicateReferrals !== false;

  if (shouldPreventDuplicates) {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const existingPlayerId = row && row[2] != null ? String(row[2]).trim() : "";
      if (existingPlayerId && existingPlayerId === String(referredPlayerId).trim()) {
        return { status: "DUPLICATE", row: i + 1 };
      }
    }
  }

  // 3. Find first available blank row where columns A-E are empty (starting from row index 1 -> sheet row 2)
  let targetRow = -1;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const isBlank =
      !row ||
      row.length === 0 ||
      row.slice(0, 5).every((cell) => cell == null || String(cell).trim() === "");
    if (isBlank) {
      targetRow = i + 1; // 1-based sheet row index
      break;
    }
  }

  if (targetRow === -1) {
    targetRow = Math.max(rows.length + 1, 2);
  }

  // 4. Format current date (YYYY-MM-DD)
  const referralDate = new Date().toISOString().split("T")[0];

  // 5. Update strictly columns A:E of the target row
  const updateRange = `${sheetTab}!A${targetRow}:E${targetRow}`;
  const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED`;

  const putRes = await customFetch(putUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      range: updateRange,
      majorDimension: "ROWS",
      values: [
        [
          referralDate,
          referredPlayerName,
          referredPlayerId,
          referredByName,
          referredById,
        ],
      ],
    }),
  });

  if (!putRes.ok) {
    const errorText = await putRes.text();
    throw new Error(`Failed to write to sheet with status ${putRes.status}: ${errorText}`);
  }

  // 6. Attach cell note to Column B of the target row
  const sheetNumericId = await getSheetNumericId(
    spreadsheetId,
    sheetTab,
    accessToken,
    customFetch
  );

  const noteContent = formatJoinDateNote(joinedAt);
  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;

  const batchRes = await customFetch(batchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          updateCells: {
            range: {
              sheetId: sheetNumericId,
              startRowIndex: targetRow - 1, // 0-based
              endRowIndex: targetRow,
              startColumnIndex: 1, // Column B (0-based: A=0, B=1)
              endColumnIndex: 2,
            },
            rows: [
              {
                values: [
                  {
                    note: noteContent,
                  },
                ],
              },
            ],
            fields: "note",
          },
        },
      ],
    }),
  });

  if (!batchRes.ok) {
    const errorText = await batchRes.text();
    console.warn(`Failed to attach join date note (${batchRes.status}): ${errorText}`);
  }

  return {
    status: "SUCCESS",
    row: targetRow,
    range: updateRange,
    note: noteContent,
  };
}
