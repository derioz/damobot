import { getGoogleAccessToken } from "../../googleSheets.js";
import {
  DEFAULT_PUNISHMENT_SHEET_TAB,
  DEFAULT_PUNISHMENT_AUDIT_TAB,
  SyncStatus,
  AuditAction,
} from "./constants.js";
import { extractNumericSequence } from "../../durableObjects/punishmentSequence.js";

export const PUNISHMENT_LOG_HEADERS = [
  "Punishment ID",
  "Created At",
  "Player Name",
  "Player Discord ID",
  "Punishment",
  "Punishment Length",
  "Reason",
  "Additional Information",
  "Report URL",
  "Response URL",
  "Evidence Image URL",
  "Staff Name",
  "Staff Discord ID",
  "Guild ID",
  "Log Channel ID",
  "Log Message ID",
  "Discord Jump URL",
  "Sync Status",
  "Normalized Player Name",
];

export const PUNISHMENT_AUDIT_HEADERS = [
  "Audit ID",
  "Punishment ID",
  "Action",
  "Changed At",
  "Changed By Name",
  "Changed By Discord ID",
  "Details",
];

/**
 * Get credentials and spreadsheet configuration from environment.
 */
function getSheetConfig(env) {
  const serviceAccountEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = env.PUNISHMENT_SHEET_ID;
  const logsTab = env.PUNISHMENT_SHEET_TAB || DEFAULT_PUNISHMENT_SHEET_TAB;
  const auditTab = env.PUNISHMENT_AUDIT_TAB || DEFAULT_PUNISHMENT_AUDIT_TAB;

  if (!serviceAccountEmail || !privateKey) {
    throw new Error(
      "Missing Google Service Account credentials (GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY)"
    );
  }
  if (!spreadsheetId) {
    throw new Error("Missing PUNISHMENT_SHEET_ID in environment configuration");
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
export async function initPunishmentSheet({ env, customFetch = fetch }) {
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

  // 3. Check and initialize headers if tabs are blank or need schema upgrade
  for (const [tab, headers] of [
    [logsTab, PUNISHMENT_LOG_HEADERS],
    [auditTab, PUNISHMENT_AUDIT_HEADERS],
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
        // Tab is blank or has older schema, write full headers
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
 * Append a new punishment record to Google Sheets with status = Pending.
 * Also appends a CREATED action to the Punishment Audits tab.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {Object} options.record
 * @param {Function} [options.customFetch]
 * @returns {Promise<{ status: string, rowIndex: number, range: string }>}
 */
export async function appendPunishmentRecord({
  env,
  record,
  customFetch = fetch,
}) {
  const { serviceAccountEmail, privateKey, spreadsheetId, logsTab, auditTab } =
    getSheetConfig(env);

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  const normalizedPlayerName = (record.playerName || "").toLowerCase().trim();

  // Columns A:S (19 columns)
  const rowValues = [
    record.punishmentId,
    record.createdAt || new Date().toISOString(),
    record.playerName,
    record.playerDiscordId || "N/A",
    record.punishment,
    record.punishmentLength || "",
    record.reason,
    record.additionalInfo || "",
    record.reportUrl || "",
    record.responseUrl || "",
    record.evidenceImageUrl || "",
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
    `${logsTab}!A:S`
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
      `Failed to append punishment to Google Sheet (${appendRes.status}): ${errorText}`
    );
  }

  const appendData = await appendRes.json();
  const updatedRange = appendData.updates?.updatedRange || "";

  // Parse row index from updatedRange e.g. "Punishment Logs!A5:P5"
  const rowMatch = updatedRange.match(/!A(\d+):/i) || updatedRange.match(/!A(\d+)$/i);
  const rowIndex = rowMatch ? parseInt(rowMatch[1], 10) : 2;

  // Append initial audit log entry
  await appendAuditEntry({
    env,
    auditRecord: {
      auditId: `AUD-${Date.now()}`,
      punishmentId: record.punishmentId,
      action: AuditAction.CREATED,
      changedAt: new Date().toISOString(),
      changedByName: record.staffName,
      changedByDiscordId: record.staffDiscordId,
      details: `Initial punishment logged: ${record.punishment} for ${record.playerName}`,
    },
    customFetch,
  }).catch((err) => {
    console.warn("Non-fatal: Failed to write initial audit entry:", err.message);
  });

  return {
    status: "SUCCESS",
    rowIndex,
    range: updatedRange,
  };
}

/**
 * Update the sync status, Discord message ID, and jump URL of a logged punishment row.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {number} options.rowIndex 1-based sheet row index
 * @param {string} options.logMessageId
 * @param {string} options.discordJumpUrl
 * @param {string} options.syncStatus
 * @param {Object} [options.staffInfo]
 * @param {string} [options.punishmentId]
 * @param {Function} [options.customFetch]
 */
export async function updatePunishmentSyncStatus({
  env,
  rowIndex,
  logMessageId = "",
  discordJumpUrl = "",
  syncStatus = SyncStatus.POSTED,
  staffInfo = null,
  punishmentId = "",
  customFetch = fetch,
}) {
  const { serviceAccountEmail, privateKey, spreadsheetId, logsTab } =
    getSheetConfig(env);

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  // Update columns P:R (Log Message ID, Discord Jump URL, Sync Status in 19-column schema)
  const updateRange = `${logsTab}!P${rowIndex}:R${rowIndex}`;
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
    console.error(`Failed to update punishment sync status (${updateRes.status}): ${errorText}`);
  }

  // Audit entry for state transition
  if (staffInfo && punishmentId) {
    const action = syncStatus === SyncStatus.POSTED ? "POSTED" : AuditAction.POST_FAILED;
    await appendAuditEntry({
      env,
      auditRecord: {
        auditId: `AUD-${Date.now()}`,
        punishmentId,
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
 * Append an entry to the Punishment Audits tab.
 */
export async function appendAuditEntry({
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
    auditRecord.auditId || `AUD-${Date.now()}`,
    auditRecord.punishmentId || "",
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
 * Map a raw Google Sheet row array to a structured Punishment record.
 * Handles both the 19-column schema and legacy 16-column rows.
 *
 * @param {Array<any>} row
 * @param {number} rowIndex 1-based row index in the sheet
 * @returns {Object}
 */
export function mapRowToPunishment(row, rowIndex) {
  // If row has 17+ columns, it follows the 19-column schema
  if (row.length > 16) {
    return {
      rowIndex,
      punishmentId: row[0] ? String(row[0]).trim() : "",
      createdAt: row[1] ? String(row[1]).trim() : "",
      playerName: row[2] ? String(row[2]).trim() : "",
      playerDiscordId: row[3] ? String(row[3]).trim() : "",
      punishment: row[4] ? String(row[4]).trim() : "",
      punishmentLength: row[5] ? String(row[5]).trim() : "",
      reason: row[6] ? String(row[6]).trim() : "",
      additionalInfo: row[7] ? String(row[7]).trim() : "",
      reportUrl: row[8] ? String(row[8]).trim() : "",
      responseUrl: row[9] ? String(row[9]).trim() : "",
      evidenceImageUrl: row[10] ? String(row[10]).trim() : "",
      staffName: row[11] ? String(row[11]).trim() : "",
      staffDiscordId: row[12] ? String(row[12]).trim() : "",
      guildId: row[13] ? String(row[13]).trim() : "",
      logChannelId: row[14] ? String(row[14]).trim() : "",
      logMessageId: row[15] ? String(row[15]).trim() : "",
      discordJumpUrl: row[16] ? String(row[16]).trim() : "",
      syncStatus: row[17] ? String(row[17]).trim() : SyncStatus.PENDING,
      normalizedPlayerName: row[18]
        ? String(row[18]).trim().toLowerCase()
        : (row[2] ? String(row[2]).trim().toLowerCase() : ""),
    };
  }

  // Legacy 16-column fallback
  return {
    rowIndex,
    punishmentId: row[0] ? String(row[0]).trim() : "",
    createdAt: row[1] ? String(row[1]).trim() : "",
    playerName: row[2] ? String(row[2]).trim() : "",
    playerDiscordId: row[3] ? String(row[3]).trim() : "",
    punishment: row[4] ? String(row[4]).trim() : "",
    punishmentLength: "",
    reason: row[5] ? String(row[5]).trim() : "",
    additionalInfo: "",
    reportUrl: row[6] ? String(row[6]).trim() : "",
    responseUrl: row[7] ? String(row[7]).trim() : "",
    evidenceImageUrl: "",
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
 * Fetch all punishment rows from the Google Sheet (excluding header row 1).
 */
export async function fetchAllPunishments({ env, customFetch = fetch }) {
  const { serviceAccountEmail, privateKey, spreadsheetId, logsTab } =
    getSheetConfig(env);

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  const readRange = `${logsTab}!A2:S`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    readRange
  )}`;

  const res = await customFetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to read punishment records (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rawRows = data.values || [];

  const records = [];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0 || !row[0]) continue;
    records.push(mapRowToPunishment(row, i + 2));
  }

  return records;
}

/**
 * Search punishments using prioritized matching rules:
 * 1. Exact full Punishment ID (e.g. VRP-P-000142)
 * 2. Numeric sequence match (e.g. 000142 or 142)
 * 3. Exact Discord ID match
 * 4. Exact normalized player name
 * 5. Partial player name
 * 6. Other text (staff name, reason, punishment text)
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.query
 * @param {Function} [options.customFetch]
 * @returns {Promise<Array<Object>>} Filtered and prioritized records (newest first)
 */
export async function searchPunishments({ env, query, customFetch = fetch }) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) return [];

  const records = await fetchAllPunishments({ env, customFetch });
  const queryLower = cleanQuery.toLowerCase();
  const numericSeq = extractNumericSequence(cleanQuery);

  const exactIdMatches = [];
  const numericIdMatches = [];
  const exactDiscordIdMatches = [];
  const exactNameMatches = [];
  const partialNameMatches = [];
  const otherMatches = [];

  for (const rec of records) {
    const recIdUpper = rec.punishmentId.toUpperCase();
    const recNumericSeq = extractNumericSequence(rec.punishmentId);
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

    // 6. Other text matches (staff name, punishment, reason)
    if (
      rec.staffName.toLowerCase().includes(queryLower) ||
      rec.staffDiscordId === cleanQuery ||
      rec.punishment.toLowerCase().includes(queryLower) ||
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
 * Look up player history specifically by Discord ID (or fallback to player name).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.discordIdOrName
 * @param {Function} [options.customFetch]
 * @returns {Promise<{ records: Array<Object>, isNameFallback: boolean, matchedKey: string }>}
 */
export async function getPlayerHistory({
  env,
  discordIdOrName,
  customFetch = fetch,
}) {
  const cleanInput = (discordIdOrName || "").trim();
  if (!cleanInput) {
    return { records: [], isNameFallback: false, matchedKey: "" };
  }

  const records = await fetchAllPunishments({ env, customFetch });
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
 * Look up the latest punishment records strictly by Player Discord ID.
 * Returns records sorted newest first (Created At descending, fallback to rowIndex descending).
 * Does NOT fall back to player name, preventing cross-matching players with similar names.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.playerDiscordId
 * @param {number} [options.limit]
 * @param {Function} [options.customFetch]
 * @returns {Promise<{ records: Array<Object>, totalCount: number }>}
 */
export async function getLatestPunishmentsByDiscordId({
  env,
  playerDiscordId,
  limit = 5,
  customFetch = fetch,
}) {
  const cleanId = String(playerDiscordId || "").trim();
  if (!cleanId || cleanId === "N/A" || cleanId === "None") {
    return { records: [], totalCount: 0 };
  }

  const allRecords = await fetchAllPunishments({ env, customFetch });
  const playerRecords = allRecords.filter(
    (r) => String(r.playerDiscordId || "").trim() === cleanId
  );

  // Sort by Created At descending (fallback to rowIndex descending)
  playerRecords.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
      return timeB - timeA;
    }
    return b.rowIndex - a.rowIndex;
  });

  const totalCount = playerRecords.length;
  const records = limit ? playerRecords.slice(0, limit) : playerRecords;

  return { records, totalCount };
}

/**
 * Fetch the latest N punishments (newest first).
 */
export async function getRecentPunishments({
  env,
  limit = 10,
  customFetch = fetch,
}) {
  const records = await fetchAllPunishments({ env, customFetch });
  records.sort((a, b) => b.rowIndex - a.rowIndex);
  return records.slice(0, limit);
}

/**
 * Fetch punishments logged by a specific staff member (newest first).
 */
export async function getMyPunishments({
  env,
  staffDiscordId,
  limit = 10,
  customFetch = fetch,
}) {
  const records = await fetchAllPunishments({ env, customFetch });
  const myRecords = records.filter(
    (r) => r.staffDiscordId === String(staffDiscordId).trim()
  );
  myRecords.sort((a, b) => b.rowIndex - a.rowIndex);
  return myRecords.slice(0, limit);
}

/**
 * Look up a single punishment record by its unique Punishment ID (e.g. VRP-P-000142).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.punishmentId
 * @param {Function} [options.customFetch]
 * @returns {Promise<Object|null>}
 */
export async function getPunishmentById({ env, punishmentId, customFetch = fetch }) {
  if (!punishmentId) return null;
  const records = await fetchAllPunishments({ env, customFetch });
  const cleanId = String(punishmentId).trim().toUpperCase();
  return records.find((r) => r.punishmentId.toUpperCase() === cleanId) || null;
}

/**
 * Edit an existing punishment record in Google Sheets without creating a duplicate row.
 * Updates columns in the existing row and appends an EDITED entry to Punishment Audits.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.punishmentId
 * @param {Object} options.updatedFields
 * @param {string} options.updatedFields.playerName
 * @param {string} options.updatedFields.punishment
 * @param {string} options.updatedFields.reason
 * @param {string} [options.updatedFields.reportUrl]
 * @param {string} [options.updatedFields.responseUrl]
 * @param {Object} [options.staffInfo]
 * @param {Function} [options.customFetch]
 * @returns {Promise<{ success: boolean, updatedRecord: Object, changesSummary: string }>}
 */
export async function updatePunishmentRecord({
  env,
  punishmentId,
  updatedFields,
  staffInfo,
  auditDetails = null,
  customFetch = fetch,
}) {
  const existing = await getPunishmentById({ env, punishmentId, customFetch });
  if (!existing) {
    throw new Error(`Punishment record '${punishmentId}' not found.`);
  }

  const { serviceAccountEmail, privateKey, spreadsheetId, logsTab } =
    getSheetConfig(env);

  const accessToken = await getGoogleAccessToken(
    serviceAccountEmail,
    privateKey,
    customFetch
  );

  const rowIndex = existing.rowIndex;

  // Track changes for audit log
  const changes = [];
  if (updatedFields.playerName && updatedFields.playerName.trim() !== existing.playerName) {
    changes.push(
      existing.playerName
        ? `Changed Player Name from "${existing.playerName}" to "${updatedFields.playerName.trim()}"`
        : `Changed Player Name to "${updatedFields.playerName.trim()}"`
    );
  }
  if (updatedFields.punishment && updatedFields.punishment.trim() !== existing.punishment) {
    changes.push(
      existing.punishment
        ? `Changed Punishment from "${existing.punishment}" to "${updatedFields.punishment.trim()}"`
        : `Changed Punishment to "${updatedFields.punishment.trim()}"`
    );
  }
  const oldLength = existing.punishmentLength || "";
  const newLength = (updatedFields.punishmentLength !== undefined ? updatedFields.punishmentLength : oldLength).trim();
  if (newLength !== oldLength) {
    changes.push(!oldLength ? "Added Punishment Length" : (newLength ? "Updated Punishment Length" : "Removed Punishment Length"));
  }
  if (updatedFields.reason && updatedFields.reason.trim() !== existing.reason) {
    changes.push("Updated Reason");
  }
  const oldInfo = existing.additionalInfo || "";
  const newInfo = (updatedFields.additionalInfo !== undefined ? updatedFields.additionalInfo : oldInfo).trim();
  if (newInfo !== oldInfo) {
    changes.push(!oldInfo ? "Added Additional Information" : (newInfo ? "Updated Additional Information" : "Removed Additional Information"));
  }
  const oldReport = existing.reportUrl || "";
  const newReport = (updatedFields.reportUrl !== undefined ? updatedFields.reportUrl : oldReport).trim();
  if (newReport !== oldReport) {
    changes.push(!oldReport ? "Added Report URL" : (newReport ? "Replaced Report URL" : "Removed Report URL"));
  }
  const oldResponse = existing.responseUrl || "";
  const newResponse = (updatedFields.responseUrl !== undefined ? updatedFields.responseUrl : oldResponse).trim();
  if (newResponse !== oldResponse) {
    changes.push(!oldResponse ? "Added Response URL" : (newResponse ? "Replaced Response URL" : "Removed Response URL"));
  }
  const oldEvidence = existing.evidenceImageUrl || "";
  const newEvidence = (updatedFields.evidenceImageUrl !== undefined ? updatedFields.evidenceImageUrl : oldEvidence).trim();
  if (newEvidence !== oldEvidence) {
    changes.push(!oldEvidence ? "Added Evidence Image URL" : (newEvidence ? "Updated Evidence Image URL" : "Removed Evidence Image URL"));
  }

  const changesSummary = changes.length > 0 ? changes.join(", ") : "No fields changed";

  const updatedRecord = {
    ...existing,
    playerName: updatedFields.playerName !== undefined ? updatedFields.playerName.trim() : existing.playerName,
    punishment: updatedFields.punishment !== undefined ? updatedFields.punishment.trim() : existing.punishment,
    punishmentLength: newLength,
    reason: updatedFields.reason !== undefined ? updatedFields.reason.trim() : existing.reason,
    additionalInfo: newInfo,
    reportUrl: newReport,
    responseUrl: newResponse,
    evidenceImageUrl: newEvidence,
    normalizedPlayerName: (updatedFields.playerName || existing.playerName).toLowerCase().trim(),
  };

  // If no fields actually changed, skip the Sheet PUT and audit append
  if (changes.length === 0) {
    return {
      success: true,
      updatedRecord,
      rowIndex,
      changesSummary,
      auditSuccess: true,
    };
  }

  // Full row values for A:S (19 columns)
  const fullRow = [
    updatedRecord.punishmentId,
    updatedRecord.createdAt,
    updatedRecord.playerName,
    updatedRecord.playerDiscordId,
    updatedRecord.punishment,
    updatedRecord.punishmentLength || "",
    updatedRecord.reason,
    updatedRecord.additionalInfo || "",
    updatedRecord.reportUrl,
    updatedRecord.responseUrl,
    updatedRecord.evidenceImageUrl || "",
    updatedRecord.staffName,
    updatedRecord.staffDiscordId,
    updatedRecord.guildId,
    updatedRecord.logChannelId,
    updatedRecord.logMessageId,
    updatedRecord.discordJumpUrl,
    updatedRecord.syncStatus,
    updatedRecord.normalizedPlayerName,
  ];

  // Update row in Google Sheets
  const updateRange = `${logsTab}!A${rowIndex}:S${rowIndex}`;
  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    updateRange
  )}?valueInputOption=USER_ENTERED`;

  const putRes = await customFetch(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      range: updateRange,
      majorDimension: "ROWS",
      values: [fullRow],
    }),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`Failed to update punishment in Google Sheet: ${errText}`);
  }

  // Append audit entry for EDITED — propagate failure to caller
  let auditSuccess = true;
  try {
    const auditResult = await appendAuditEntry({
      env,
      auditRecord: {
        auditId: `AUD-${Date.now()}`,
        punishmentId,
        action: AuditAction.EDITED,
        changedAt: new Date().toISOString(),
        changedByName: staffInfo?.name || "Staff",
        changedByDiscordId: staffInfo?.id || "0",
        details: auditDetails || changesSummary,
      },
      customFetch,
    });
    auditSuccess = auditResult?.success !== false;
  } catch (auditErr) {
    console.error(`Audit append failed for ${punishmentId}:`, auditErr);
    auditSuccess = false;
  }

  return {
    success: true,
    updatedRecord,
    rowIndex,
    changesSummary,
    auditSuccess,
  };
}
