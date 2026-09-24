import { getGoogleAccessToken } from "../../googleSheets.js";
import {
  DEFAULT_REFUND_SHEET_TAB,
  DEFAULT_REFUND_AUDIT_TAB,
  REFUND_SHEET_COLUMNS,
  SyncStatus,
  AuditAction,
  refundConfig,
} from "./constants.js";
import { extractRefundNumericSequence } from "../../durableObjects/punishmentSequence.js";

export const REFUND_LOG_HEADERS = REFUND_SHEET_COLUMNS;

const REFUND_AUDIT_COLUMNS = [
  "Timestamp",
  "Action",
  "Refund ID",
  "Staff Name",
  "Staff Discord ID",
  "Details",
];

export const REFUND_AUDIT_HEADERS = REFUND_AUDIT_COLUMNS;

/**
 * Get credentials and spreadsheet configuration from environment.
 * Falls back to PUNISHMENT_SHEET_ID or refundConfig.settings.sheetId if REFUND_SHEET_ID is not explicitly configured.
 */
function getSheetConfig(env) {
  const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId =
    env.REFUND_SHEET_ID ||
    env.PUNISHMENT_SHEET_ID ||
    refundConfig.settings?.sheetId;
  const logsTab = env.REFUND_SHEET_TAB || DEFAULT_REFUND_SHEET_TAB;
  const auditTab = env.REFUND_AUDIT_TAB || DEFAULT_REFUND_AUDIT_TAB;

  if (!serviceAccountEmail || !privateKey) {
    throw new Error(
      "Missing Google Service Account credentials (GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY)"
    );
  }
  if (!spreadsheetId) {
    throw new Error("Missing REFUND_SHEET_ID or PUNISHMENT_SHEET_ID in environment configuration");
  }

  return {
    serviceAccountEmail,
    privateKey,
    spreadsheetId,
    logsTab,
    auditTab,
  };
}

/**
 * Safely verify or initialize the Google Spreadsheet tabs and headers.
 * Does NOT overwrite existing records or modify existing data.
 */
export async function initRefundSheet({ env, customFetch = fetch }) {
  const { serviceAccountEmail, privateKey, spreadsheetId, logsTab, auditTab } =
    getSheetConfig(env);

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  // 1. Fetch spreadsheet metadata to check existing tabs
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;
  const metaRes = await customFetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!metaRes.ok) {
    const errorText = await metaRes.text();
    throw new Error(
      `Failed to access Google Spreadsheet (${metaRes.status}): ${errorText}`
    );
  }

  const metaData = await metaRes.json();
  const existingSheets = (metaData.sheets || []).map(
    (s) => s.properties?.title
  );

  // 2. Create missing tabs if needed
  const missingTabs = [];
  if (!existingSheets.includes(logsTab)) missingTabs.push(logsTab);
  if (!existingSheets.includes(auditTab)) missingTabs.push(auditTab);

  if (missingTabs.length > 0) {
    const batchRequests = missingTabs.map((tabTitle) => ({
      addSheet: {
        properties: { title: tabTitle },
      },
    }));

    const addRes = await customFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests: batchRequests }),
      }
    );

    if (!addRes.ok) {
      const errorText = await addRes.text();
      throw new Error(`Failed to create missing sheet tabs: ${errorText}`);
    }
  }

  // 3. Check and initialize headers if tabs are blank
  for (const [tab, headers] of [
    [logsTab, REFUND_LOG_HEADERS],
    [auditTab, REFUND_AUDIT_HEADERS],
  ]) {
    const checkUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      `${tab}!A1:Z1`
    )}`;
    const checkRes = await customFetch(checkUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (checkRes.ok) {
      const valData = await checkRes.json();
      const existingHeaders = valData.values?.[0] || [];
      if (existingHeaders.length === 0 || existingHeaders.length < headers.length) {
        const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
          `${tab}!A1`
        )}?valueInputOption=USER_ENTERED`;
        await customFetch(writeUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            range: `${tab}!A1`,
            majorDimension: "ROWS",
            values: [headers],
          }),
        });
      }
    }
  }

  return { success: true, logsTab, auditTab };
}

/**
 * Append a new refund record to Google Sheets with status = Pending.
 * Also appends a CREATED action to the Refund Audits tab.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {Object} options.record
 * @param {Function} [options.customFetch]
 * @returns {Promise<{ status: string, rowIndex: number, range: string }>}
 */
export async function appendRefundRecord({
  env,
  record,
  customFetch = fetch,
}) {
  const { serviceAccountEmail, privateKey, spreadsheetId, logsTab } =
    getSheetConfig(env);

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  const normalizedPlayerName = (record.playerName || "").toLowerCase().trim();

  // Columns A:P (16 columns)
  const rowValues = [
    record.refundId,
    record.createdAt || new Date().toISOString(),
    record.playerName,
    record.playerDiscordId || "N/A",
    record.refundCategory || "Other",
    record.refundDetails || "",
    record.reason || "",
    record.ticketUrl || "",
    record.staffName,
    record.staffDiscordId,
    record.guildId || "",
    record.logChannelId || "",
    record.logMessageId || "",
    record.discordJumpUrl || "",
    record.syncStatus || SyncStatus.PENDING,
    normalizedPlayerName,
  ];

  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    `${logsTab}!A:P`
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const appendRes = await customFetch(appendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      majorDimension: "ROWS",
      values: [rowValues],
    }),
  });

  if (!appendRes.ok) {
    const errorText = await appendRes.text();
    throw new Error(
      `Failed to append refund to Google Sheet (${appendRes.status}): ${errorText}`
    );
  }

  const appendData = await appendRes.json();
  const updatedRange = appendData.updates?.updatedRange || "";

  // Parse row index from updatedRange e.g. "Refund Log!A5:P5"
  const rowMatch = updatedRange.match(/!A(\d+):/i) || updatedRange.match(/!A(\d+)$/i);
  const rowIndex = rowMatch ? parseInt(rowMatch[1], 10) : 2;

  // Append initial audit log entry
  await appendRefundAuditEntry({
    env,
    auditRecord: {
      auditId: `AUD-R-${Date.now()}`,
      refundId: record.refundId,
      action: AuditAction.CREATED,
      changedAt: new Date().toISOString(),
      changedByName: record.staffName,
      changedByDiscordId: record.staffDiscordId,
      details: `Initial refund logged: [${record.refundCategory}] ${record.refundDetails} for ${record.playerName}`,
    },
    customFetch,
  }).catch((err) => {
    console.warn("Non-fatal: Failed to write initial refund audit entry:", err.message);
  });

  return {
    status: "SUCCESS",
    rowIndex,
    range: updatedRange,
  };
}

/**
 * Update the sync status, Discord message ID, and jump URL of a logged refund row.
 * In 16-column layout:
 * - Col M (13th) = Log Message ID
 * - Col N (14th) = Discord Jump URL
 * - Col O (15th) = Sync Status
 * Range: M{rowIndex}:O{rowIndex}
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {number} options.rowIndex 1-based sheet row index
 * @param {string} options.logMessageId
 * @param {string} options.discordJumpUrl
 * @param {string} options.syncStatus
 * @param {Object} [options.staffInfo]
 * @param {string} [options.refundId]
 * @param {Function} [options.customFetch]
 */
export async function updateRefundSyncStatus({
  env,
  rowIndex,
  logMessageId = "",
  discordJumpUrl = "",
  syncStatus = SyncStatus.POSTED,
  staffInfo = null,
  refundId = "",
  customFetch = fetch,
}) {
  const { serviceAccountEmail, privateKey, spreadsheetId, logsTab } =
    getSheetConfig(env);

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  // Update columns M:O (Log Message ID, Discord Jump URL, Sync Status in 16-column schema)
  const updateRange = `${logsTab}!M${rowIndex}:O${rowIndex}`;
  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    updateRange
  )}?valueInputOption=USER_ENTERED`;

  const updateRes = await customFetch(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      range: updateRange,
      majorDimension: "ROWS",
      values: [[logMessageId, discordJumpUrl, syncStatus]],
    }),
  });

  if (!updateRes.ok) {
    const errorText = await updateRes.text();
    console.error(`Failed to update refund sync status (${updateRes.status}): ${errorText}`);
  }

  // Audit entry for state transition
  if (staffInfo && refundId) {
    const action = syncStatus === SyncStatus.POSTED ? "POSTED" : AuditAction.POST_FAILED;
    await appendRefundAuditEntry({
      env,
      auditRecord: {
        auditId: `AUD-R-${Date.now()}`,
        refundId,
        action,
        changedAt: new Date().toISOString(),
        changedByName: staffInfo.name || "System",
        changedByDiscordId: staffInfo.id || "0",
        details: `Sync status transitioned to ${syncStatus} (Message ID: ${logMessageId || "None"})`,
      },
      customFetch,
    }).catch(() => {});
  }

  return { success: updateRes.ok };
}

/**
 * Append an entry to the Refund Audits tab.
 */
export async function appendRefundAuditEntry({
  env,
  auditRecord,
  customFetch = fetch,
}) {
  const { serviceAccountEmail, privateKey, spreadsheetId, auditTab } =
    getSheetConfig(env);

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  const rowValues = [
    auditRecord.auditId || `AUD-R-${Date.now()}`,
    auditRecord.refundId || "",
    auditRecord.action || AuditAction.CREATED,
    auditRecord.changedAt || new Date().toISOString(),
    auditRecord.changedByName || "Staff",
    auditRecord.changedByDiscordId || "",
    auditRecord.details || "",
  ];

  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    `${auditTab}!A:G`
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await customFetch(appendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      majorDimension: "ROWS",
      values: [rowValues],
    }),
  });

  return { success: res.ok };
}

/**
 * Map a raw Google Sheet row array to a structured Refund record (16-column layout).
 *
 * @param {Array<any>} row
 * @param {number} rowIndex 1-based row index in the sheet
 * @returns {Object}
 */
export function mapRowToRefund(row, rowIndex) {
  return {
    rowIndex,
    refundId: row[0] ? String(row[0]).trim() : "",
    createdAt: row[1] ? String(row[1]).trim() : "",
    playerName: row[2] ? String(row[2]).trim() : "",
    playerDiscordId: row[3] ? String(row[3]).trim() : "",
    refundCategory: row[4] ? String(row[4]).trim() : "",
    refundDetails: row[5] ? String(row[5]).trim() : "",
    reason: row[6] ? String(row[6]).trim() : "",
    ticketUrl: row[7] ? String(row[7]).trim() : "",
    staffName: row[8] ? String(row[8]).trim() : "",
    staffDiscordId: row[9] ? String(row[9]).trim() : "",
    guildId: row[10] ? String(row[10]).trim() : "",
    logChannelId: row[11] ? String(row[11]).trim() : "",
    logMessageId: row[12] ? String(row[12]).trim() : "",
    discordJumpUrl: row[13] ? String(row[13]).trim() : "",
    syncStatus: row[14] ? String(row[14]).trim() : SyncStatus.PENDING,
    normalizedPlayerName: row[15]
      ? String(row[15]).trim().toLowerCase()
      : (row[2] ? String(row[2]).trim().toLowerCase() : ""),
  };
}

/**
 * Fetch all refund rows from the Google Sheet (excluding header row 1).
 */
export async function fetchAllRefunds({ env, customFetch = fetch }) {
  const { serviceAccountEmail, privateKey, spreadsheetId, logsTab } =
    getSheetConfig(env);

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  const readRange = `${logsTab}!A2:P`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    readRange
  )}`;

  const res = await customFetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to read refund records (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawRows = data.values || [];

  const records = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0 || !row[0]) continue;
    records.push(mapRowToRefund(row, i + 2));
  }

  return records;
}

/**
 * Search refunds using prioritized matching rules and optional category filter:
 * 1. Exact full Refund ID (e.g. VRP-R-000001)
 * 2. Numeric sequence match (e.g. 000001 or 1)
 * 3. Exact Discord ID match
 * 4. Exact normalized player name
 * 5. Partial player name
 * 6. Other text (staff name, refund details, reason)
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.query
 * @param {string} [options.categoryFilter] "All", "Vitcoin", "Cash", "S-Coin", "Other"
 * @param {Function} [options.customFetch]
 * @returns {Promise<Array<Object>>} Filtered and prioritized records (newest first)
 */
export async function searchRefunds({
  env,
  query,
  categoryFilter = "All",
  customFetch = fetch,
}) {
  const cleanQuery = (query || "").trim();
  let records = await fetchAllRefunds({ env, customFetch });

  // Filter by category if specified and not "All"
  if (categoryFilter && categoryFilter.toLowerCase() !== "all") {
    const catLower = categoryFilter.toLowerCase();
    records = records.filter(
      (r) => (r.refundCategory || "").toLowerCase() === catLower
    );
  }

  if (!cleanQuery) {
    // If no query text, return all filtered records sorted newest first
    records.sort((a, b) => b.rowIndex - a.rowIndex);
    return records;
  }

  const queryLower = cleanQuery.toLowerCase();
  const numericSeq = extractRefundNumericSequence(cleanQuery);

  const exactIdMatches = [];
  const numericIdMatches = [];
  const exactDiscordIdMatches = [];
  const exactNameMatches = [];
  const partialNameMatches = [];
  const otherMatches = [];

  for (const rec of records) {
    const recIdUpper = rec.refundId.toUpperCase();
    const recNumericSeq = extractRefundNumericSequence(rec.refundId);
    const recDiscordId = rec.playerDiscordId;
    const recNameLower = rec.normalizedPlayerName;

    // 1. Exact full ID
    if (recIdUpper === cleanQuery.toUpperCase()) {
      exactIdMatches.push(rec);
      continue;
    }

    // 2. Numeric ID match
    if (numericSeq !== null && recNumericSeq !== null && recNumericSeq === numericSeq) {
      numericIdMatches.push(rec);
      continue;
    }

    // 3. Exact Discord ID
    if (recDiscordId && recDiscordId === cleanQuery) {
      exactDiscordIdMatches.push(rec);
      continue;
    }

    // 4. Exact Player Name
    if (recNameLower === queryLower) {
      exactNameMatches.push(rec);
      continue;
    }

    // 5. Partial Player Name
    if (recNameLower.includes(queryLower)) {
      partialNameMatches.push(rec);
      continue;
    }

    // 6. Other text matches (staff name, details, reason)
    if (
      rec.staffName.toLowerCase().includes(queryLower) ||
      rec.staffDiscordId === cleanQuery ||
      rec.refundDetails.toLowerCase().includes(queryLower) ||
      rec.reason.toLowerCase().includes(queryLower)
    ) {
      otherMatches.push(rec);
    }
  }

  // Sort each tier newest first (higher rowIndex = newer)
  const sortByNewest = (a, b) => b.rowIndex - a.rowIndex;

  exactIdMatches.sort(sortByNewest);
  numericIdMatches.sort(sortByNewest);
  exactDiscordIdMatches.sort(sortByNewest);
  exactNameMatches.sort(sortByNewest);
  partialNameMatches.sort(sortByNewest);
  otherMatches.sort(sortByNewest);

  return [
    ...exactIdMatches,
    ...numericIdMatches,
    ...exactDiscordIdMatches,
    ...exactNameMatches,
    ...partialNameMatches,
    ...otherMatches,
  ];
}

/**
 * Look up player refund history specifically by Discord ID (or fallback to player name).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.discordIdOrName
 * @param {Function} [options.customFetch]
 * @returns {Promise<{ records: Array<Object>, isNameFallback: boolean, matchedKey: string }>}
 */
export async function getPlayerRefundHistory({
  env,
  discordIdOrName,
  customFetch = fetch,
}) {
  const cleanInput = (discordIdOrName || "").trim();
  if (!cleanInput) {
    return { records: [], isNameFallback: false, matchedKey: "" };
  }

  const records = await fetchAllRefunds({ env, customFetch });
  const isDiscordId = /^\d{17,20}$/.test(cleanInput);

  let matched = [];
  let isNameFallback = false;

  if (isDiscordId) {
    matched = records.filter((r) => r.playerDiscordId === cleanInput);
  }

  // Fallback to name match if not a Discord ID or no Discord ID match found
  if (matched.length === 0) {
    const inputLower = cleanInput.toLowerCase();
    matched = records.filter(
      (r) => r.normalizedPlayerName === inputLower || r.playerName.toLowerCase() === inputLower
    );
    isNameFallback = true;
  }

  matched.sort((a, b) => b.rowIndex - a.rowIndex);

  return {
    records: matched,
    isNameFallback,
    matchedKey: cleanInput,
  };
}

/**
 * Look up refund records strictly by exact Player Discord ID.
 * Never falls back to player name.
 * Returns records sorted newest first.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.playerDiscordId
 * @param {Function} [options.customFetch]
 * @returns {Promise<Array<Object>>}
 */
export async function getRefundsByPlayerDiscordId({
  env,
  playerDiscordId,
  customFetch = fetch,
}) {
  const cleanId = String(playerDiscordId || "").trim();
  if (!cleanId || cleanId === "N/A" || cleanId === "None") {
    return [];
  }

  const records = await fetchAllRefunds({ env, customFetch });
  const matched = records.filter(
    (r) => String(r.playerDiscordId || "").trim() === cleanId
  );

  matched.sort((a, b) => b.rowIndex - a.rowIndex);
  return matched;
}

/**
 * Fetch the latest N refunds (newest first) with optional category filter.
 */
export async function getRecentRefunds({
  env,
  limit = 10,
  categoryFilter = "All",
  customFetch = fetch,
}) {
  let records = await fetchAllRefunds({ env, customFetch });
  if (categoryFilter && categoryFilter.toLowerCase() !== "all") {
    const catLower = categoryFilter.toLowerCase();
    records = records.filter(
      (r) => (r.refundCategory || "").toLowerCase() === catLower
    );
  }
  records.sort((a, b) => b.rowIndex - a.rowIndex);
  return records.slice(0, limit);
}

/**
 * Fetch refunds logged by a specific staff member (newest first) with optional category filter.
 */
export async function getMyRefunds({
  env,
  staffDiscordId,
  limit = 10,
  categoryFilter = "All",
  customFetch = fetch,
}) {
  let records = await fetchAllRefunds({ env, customFetch });
  records = records.filter(
    (r) => r.staffDiscordId === String(staffDiscordId).trim()
  );
  if (categoryFilter && categoryFilter.toLowerCase() !== "all") {
    const catLower = categoryFilter.toLowerCase();
    records = records.filter(
      (r) => (r.refundCategory || "").toLowerCase() === catLower
    );
  }
  records.sort((a, b) => b.rowIndex - a.rowIndex);
  return records.slice(0, limit);
}

/**
 * Look up a single refund record by its unique Refund ID (e.g. VRP-R-000001).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.refundId
 * @param {Function} [options.customFetch]
 * @returns {Promise<Object|null>}
 */
export async function getRefundById({ env, refundId, customFetch = fetch }) {
  if (!refundId) return null;
  const records = await fetchAllRefunds({ env, customFetch });
  const cleanId = String(refundId).trim().toUpperCase();
  return records.find((r) => r.refundId.toUpperCase() === cleanId) || null;
}
