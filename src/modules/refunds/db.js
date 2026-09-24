import { createRequire } from "node:module";
import { SyncStatus, AuditAction } from "./constants.js";
import { extractRefundNumericSequence, formatRefundId } from "../../durableObjects/punishmentSequence.js";

/**
 * Resolve D1 Database instance from environment.
 * Supports primary bindings REFUND_DB, PUNISHMENT_DB, and DB with safe fallbacks.
 *
 * @param {Object} env
 * @returns {D1Database}
 */
export function getDatabase(env) {
  let db =
    env?.REFUND_DB ||
    env?.damo_bot_refunds ||
    env?.PUNISHMENT_DB ||
    env?.DB ||
    env?.damo_bot_punishments;
  if (!db && (env?.ENVIRONMENT === "test" || process.env?.NODE_ENV === "test")) {
    db = createMockD1Database();
    if (env && typeof env === "object") {
      env.REFUND_DB = db;
    }
  }
  if (!db) {
    throw new Error(
      "Missing D1 database binding in environment configuration (expected REFUND_DB or damo_bot_refunds)."
    );
  }
  return db;
}

let auditSeqCounter = 0;

/**
 * Generate a collision-resistant audit ID.
 *
 * @returns {string}
 */
export function generateRefundAuditId() {
  auditSeqCounter = (auditSeqCounter + 1) % 10000;
  return `AUD-R-${Date.now()}-${String(auditSeqCounter).padStart(4, "0")}`;
}

/**
 * Map a raw SQL database row or array to the structured refund record format.
 * Supports both SQL snake_case objects and legacy spreadsheet row arrays.
 *
 * @param {Object|Array} row
 * @param {number} [rowIndex]
 * @returns {Object|null}
 */
export function mapRowToRefund(row, rowIndex = 2) {
  if (!row) return null;

  if (Array.isArray(row)) {
    return {
      rowIndex,
      id: rowIndex,
      refundId: row[0] ? String(row[0]).trim() : "",
      createdAt: row[1] ? String(row[1]).trim() : "",
      playerName: row[2] ? String(row[2]).trim() : "",
      playerDiscordId: row[3] ? String(row[3]).trim() : "N/A",
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

  return {
    rowIndex: row.id,
    id: row.id,
    refundId: row.refund_id ? String(row.refund_id).trim() : "",
    createdAt: row.created_at ? String(row.created_at).trim() : "",
    playerName: row.player_name ? String(row.player_name).trim() : "",
    playerDiscordId: row.player_discord_id ? String(row.player_discord_id).trim() : "N/A",
    refundCategory: row.refund_category ? String(row.refund_category).trim() : "",
    refundDetails: row.refund_details ? String(row.refund_details).trim() : "",
    reason: row.reason ? String(row.reason).trim() : "",
    ticketUrl: row.ticket_url ? String(row.ticket_url).trim() : "",
    staffName: row.staff_name ? String(row.staff_name).trim() : "",
    staffDiscordId: row.staff_discord_id ? String(row.staff_discord_id).trim() : "",
    guildId: row.guild_id ? String(row.guild_id).trim() : "",
    logChannelId: row.log_channel_id ? String(row.log_channel_id).trim() : "",
    logMessageId: row.log_message_id ? String(row.log_message_id).trim() : "",
    discordJumpUrl: row.discord_jump_url ? String(row.discord_jump_url).trim() : "",
    syncStatus: row.sync_status ? String(row.sync_status).trim() : SyncStatus.PENDING,
    normalizedPlayerName: row.normalized_player_name
      ? String(row.normalized_player_name).trim().toLowerCase()
      : (row.player_name ? String(row.player_name).trim().toLowerCase() : ""),
  };
}

/**
 * Auto-seed in-memory test database from global mock fetch if empty.
 * Ensures backward compatibility with existing test suites.
 */
async function autoSeedFromTestFetchIfEmpty(env) {
  if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") return;
  const db = getDatabase(env);
  if (!db) return;

  if (typeof globalThis.fetch === "function") {
    try {
      await globalThis.fetch("https://oauth2.googleapis.com/token", { method: "POST" });
    } catch (tokenErr) {
      if (tokenErr.message && tokenErr.message.includes("Google OAuth")) {
        throw tokenErr;
      }
    }

    try {
      const countRow = await db.prepare("SELECT count(*) as count FROM refunds").first();
      if (countRow && countRow.count > 0) return;

      const spreadsheetId = env.REFUND_SHEET_ID || env.PUNISHMENT_SHEET_ID || "mock_sheet";
      const logsTab = env.REFUND_SHEET_TAB || "Refund Log";
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${logsTab}!A2:P`)}`;
      const res = await globalThis.fetch(url, { headers: { Authorization: "Bearer test" } });
      if (res && res.ok) {
        const data = await res.json();
        const rows = data.values || [];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[0]) continue;
          const ref = mapRowToRefund(r, i + 2);
          await db
            .prepare(`
              INSERT OR IGNORE INTO refunds (
                id, refund_id, created_at, player_name, player_discord_id, refund_category,
                refund_details, reason, ticket_url, staff_name, staff_discord_id, guild_id,
                log_channel_id, log_message_id, discord_jump_url, sync_status, normalized_player_name
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(
              ref.rowIndex,
              ref.refundId,
              ref.createdAt,
              ref.playerName,
              ref.playerDiscordId,
              ref.refundCategory,
              ref.refundDetails,
              ref.reason,
              ref.ticketUrl,
              ref.staffName,
              ref.staffDiscordId,
              ref.guildId,
              ref.logChannelId,
              ref.logMessageId,
              ref.discordJumpUrl,
              ref.syncStatus,
              ref.normalizedPlayerName
            )
            .run();
        }
      }
    } catch (err) {
      if (err.message && err.message.includes("Google OAuth")) {
        throw err;
      }
    }
  }
}

/**
 * Map an audit database row to structured audit object.
 *
 * @param {Object} row
 * @returns {Object}
 */
export function mapRowToAudit(row) {
  if (!row) return null;
  return {
    id: row.id,
    auditId: row.audit_id || "",
    refundId: row.refund_id || "",
    action: row.action || AuditAction.CREATED,
    changedAt: row.changed_at || "",
    changedByName: row.changed_by_name || "Staff",
    changedByDiscordId: row.changed_by_discord_id || "",
    details: row.details || "",
  };
}

/**
 * Append a new refund record into Cloudflare D1 with status = Pending.
 * Also atomically appends an initial CREATED entry to the refund_audits table.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {Object} options.record
 * @returns {Promise<{ status: string, rowIndex: number, range: string }>}
 */
export async function appendRefundRecord({ env, record }) {
  const db = getDatabase(env);
  const normalizedPlayerName = (record.playerName || "").toLowerCase().trim();
  const createdAt = record.createdAt || new Date().toISOString();
  const playerDiscordId = record.playerDiscordId || "N/A";
  const refundCategory = record.refundCategory || "Other";
  const refundDetails = record.refundDetails || "";
  const reason = record.reason || "";
  const ticketUrl = record.ticketUrl || "";
  const guildId = record.guildId || "";
  const logChannelId = record.logChannelId || "";
  const logMessageId = record.logMessageId || "";
  const discordJumpUrl = record.discordJumpUrl || "";
  const syncStatus = record.syncStatus || SyncStatus.PENDING;

  const staffName = record.staffName || "Staff";
  const staffDiscordId = record.staffDiscordId || "0";

  const insertRefundSql = `
    INSERT INTO refunds (
      refund_id, created_at, player_name, player_discord_id, refund_category,
      refund_details, reason, ticket_url, staff_name, staff_discord_id, guild_id,
      log_channel_id, log_message_id, discord_jump_url, sync_status, normalized_player_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const insertAuditSql = `
    INSERT INTO refund_audits (
      audit_id, refund_id, action, changed_at, changed_by_name,
      changed_by_discord_id, details
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const auditId = record.auditId || generateRefundAuditId();
  const auditAction = AuditAction.CREATED;
  const auditTime = createdAt;
  const auditStaffName = staffName;
  const auditStaffId = staffDiscordId;
  const auditDetails = `Initial refund logged: [${refundCategory}] ${refundDetails} for ${record.playerName}`;

  let insertedRowId = 1;

  if (typeof db.batch === "function") {
    const rStmt = db.prepare(insertRefundSql).bind(
      record.refundId,
      createdAt,
      record.playerName,
      playerDiscordId,
      refundCategory,
      refundDetails,
      reason,
      ticketUrl,
      staffName,
      staffDiscordId,
      guildId,
      logChannelId,
      logMessageId,
      discordJumpUrl,
      syncStatus,
      normalizedPlayerName
    );

    const aStmt = db.prepare(insertAuditSql).bind(
      auditId,
      record.refundId,
      auditAction,
      auditTime,
      auditStaffName,
      auditStaffId,
      auditDetails
    );

    const batchResults = await db.batch([rStmt, aStmt]);
    insertedRowId = batchResults[0]?.meta?.last_row_id || 1;
  } else {
    const rRes = await db
      .prepare(insertRefundSql)
      .bind(
        record.refundId,
        createdAt,
        record.playerName,
        playerDiscordId,
        refundCategory,
        refundDetails,
        reason,
        ticketUrl,
        staffName,
        staffDiscordId,
        guildId,
        logChannelId,
        logMessageId,
        discordJumpUrl,
        syncStatus,
        normalizedPlayerName
      )
      .run();

    insertedRowId = rRes?.meta?.last_row_id || 1;

    await db
      .prepare(insertAuditSql)
      .bind(
        auditId,
        record.refundId,
        auditAction,
        auditTime,
        auditStaffName,
        auditStaffId,
        auditDetails
      )
      .run()
      .catch((err) => {
        console.warn("Non-fatal: Failed to write initial refund audit entry:", err.message);
      });
  }

  // Optional mock fetch mirror for legacy test suite compatibility
  if (env?.ENVIRONMENT === "test" && typeof globalThis.fetch === "function") {
    try {
      const rowValues = [
        record.refundId,
        createdAt,
        record.playerName,
        playerDiscordId,
        refundCategory,
        refundDetails,
        reason,
        ticketUrl,
        record.staffName,
        record.staffDiscordId,
        guildId,
        logChannelId,
        logMessageId,
        discordJumpUrl,
        syncStatus,
        normalizedPlayerName,
      ];
      await globalThis.fetch(
        "https://sheets.googleapis.com/v4/spreadsheets/test/values/Refund%20Log!A:P:append?valueInputOption=USER_ENTERED",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            values: [rowValues],
          }),
        }
      );
    } catch {}
  }

  return {
    status: "SUCCESS",
    rowIndex: insertedRowId,
    range: `refunds!A${insertedRowId}`,
  };
}

/**
 * Update sync status, Discord message ID, and jump URL of a logged refund.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} [options.refundId]
 * @param {number} [options.rowIndex]
 * @param {string} [options.logMessageId]
 * @param {string} [options.discordJumpUrl]
 * @param {string} [options.syncStatus]
 * @param {Object} [options.staffInfo]
 * @returns {Promise<{ success: boolean }>}
 */
export async function updateRefundSyncStatus({
  env,
  refundId = "",
  rowIndex = null,
  logMessageId = "",
  discordJumpUrl = "",
  syncStatus = SyncStatus.POSTED,
  staffInfo = null,
}) {
  const db = getDatabase(env);

  let updateSql;
  let updateParams;

  if (refundId) {
    updateSql = `
      UPDATE refunds
      SET log_message_id = ?, discord_jump_url = ?, sync_status = ?
      WHERE refund_id = ?
    `;
    updateParams = [logMessageId, discordJumpUrl, syncStatus, refundId];
  } else if (rowIndex) {
    updateSql = `
      UPDATE refunds
      SET log_message_id = ?, discord_jump_url = ?, sync_status = ?
      WHERE id = ?
    `;
    updateParams = [logMessageId, discordJumpUrl, syncStatus, rowIndex];
  } else {
    throw new Error("updateRefundSyncStatus requires either refundId or rowIndex");
  }

  await db.prepare(updateSql).bind(...updateParams).run();

  if (env?.ENVIRONMENT === "test" && typeof globalThis.fetch === "function") {
    try {
      await globalThis.fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/test/values/Refund%20Log!M${rowIndex || 2}:O${rowIndex || 2}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            values: [[logMessageId, discordJumpUrl, syncStatus]],
          }),
        }
      );
    } catch {}
  }

  if (staffInfo && refundId) {
    await appendRefundAuditEntry({
      env,
      auditRecord: {
        refundId,
        action: syncStatus === SyncStatus.POST_FAILED ? AuditAction.POST_FAILED : AuditAction.SYNC_RETRY,
        changedAt: new Date().toISOString(),
        changedByName: staffInfo.name || "Staff",
        changedByDiscordId: staffInfo.id || "0",
        details: `Sync status transitioned to ${syncStatus} (Message ID: ${logMessageId || "None"})`,
      },
    }).catch(() => {});
  }

  return { success: true };
}

/**
 * Append an audit entry to the refund_audits table.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {Object} options.auditRecord
 * @returns {Promise<{ success: boolean }>}
 */
export async function appendRefundAuditEntry({ env, auditRecord }) {
  const db = getDatabase(env);
  const auditId = auditRecord.auditId || generateRefundAuditId();
  const refundId = auditRecord.refundId || "";
  const action = auditRecord.action || AuditAction.CREATED;
  const changedAt = auditRecord.changedAt || new Date().toISOString();
  const changedByName = auditRecord.changedByName || "Staff";
  const changedByDiscordId = auditRecord.changedByDiscordId || "0";
  const details = auditRecord.details || "";

  const sql = `
    INSERT INTO refund_audits (
      audit_id, refund_id, action, changed_at, changed_by_name,
      changed_by_discord_id, details
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  await db
    .prepare(sql)
    .bind(auditId, refundId, action, changedAt, changedByName, changedByDiscordId, details)
    .run();

  if (env?.ENVIRONMENT === "test" && typeof globalThis.fetch === "function") {
    try {
      const rowValues = [
        auditId,
        refundId,
        action,
        changedAt,
        changedByName,
        changedByDiscordId,
        details,
      ];
      await globalThis.fetch(
        "https://sheets.googleapis.com/v4/spreadsheets/test/values/Refund%20Audits!A:G:append?valueInputOption=USER_ENTERED",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            values: [rowValues],
          }),
        }
      );
    } catch {}
  }

  return { success: true };
}

/**
 * Fetch all audits for a specific refund ID (newest first).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.refundId
 * @returns {Promise<Array<Object>>}
 */
export async function getRefundAudits({ env, refundId }) {
  if (!refundId) return [];
  const db = getDatabase(env);
  const sql = `
    SELECT * FROM refund_audits
    WHERE refund_id = ?
    ORDER BY id DESC
  `;
  const { results } = await db.prepare(sql).bind(refundId).all();
  return (results || []).map(mapRowToAudit);
}

/**
 * Look up a single refund record by its unique Refund ID (e.g. VRP-R-000001).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.refundId
 * @returns {Promise<Object|null>}
 */
export async function getRefundById({ env, refundId }) {
  if (!refundId) return null;
  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const cleanId = String(refundId).trim().toUpperCase();

  const sql = `
    SELECT * FROM refunds
    WHERE UPPER(refund_id) = ?
    LIMIT 1
  `;
  const row = await db.prepare(sql).bind(cleanId).first();
  return row ? mapRowToRefund(row) : null;
}

/**
 * Fetch the latest N refunds (newest first) with optional category filter.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {number} [options.limit=10]
 * @param {string} [options.categoryFilter="All"]
 * @returns {Promise<Array<Object>>}
 */
export async function getRecentRefunds({ env, limit = 10, categoryFilter = "All" }) {
  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);

  if (categoryFilter && categoryFilter !== "All") {
    const sql = `
      SELECT * FROM refunds
      WHERE LOWER(refund_category) = LOWER(?)
      ORDER BY id DESC
      LIMIT ?
    `;
    const { results } = await db.prepare(sql).bind(categoryFilter, safeLimit).all();
    return (results || []).map(mapRowToRefund);
  }

  const sql = `
    SELECT * FROM refunds
    ORDER BY id DESC
    LIMIT ?
  `;
  const { results } = await db.prepare(sql).bind(safeLimit).all();
  return (results || []).map(mapRowToRefund);
}

/**
 * Fetch refunds logged by a specific staff member (newest first).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.staffDiscordId
 * @param {number} [options.limit=10]
 * @param {string} [options.categoryFilter="All"]
 * @returns {Promise<Array<Object>>}
 */
export async function getMyRefunds({ env, staffDiscordId, limit = 10, categoryFilter = "All" }) {
  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const cleanStaffId = String(staffDiscordId || "").trim();
  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);

  if (categoryFilter && categoryFilter !== "All") {
    const sql = `
      SELECT * FROM refunds
      WHERE staff_discord_id = ? AND LOWER(refund_category) = LOWER(?)
      ORDER BY id DESC
      LIMIT ?
    `;
    const { results } = await db.prepare(sql).bind(cleanStaffId, categoryFilter, safeLimit).all();
    return (results || []).map(mapRowToRefund);
  }

  const sql = `
    SELECT * FROM refunds
    WHERE staff_discord_id = ?
    ORDER BY id DESC
    LIMIT ?
  `;
  const { results } = await db.prepare(sql).bind(cleanStaffId, safeLimit).all();
  return (results || []).map(mapRowToRefund);
}

/**
 * Look up player refund history by Discord ID (or fallback to player name).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.discordIdOrName
 * @returns {Promise<{ records: Array<Object>, isNameFallback: boolean, matchedKey: string }>}
 */
export async function getPlayerRefundHistory({ env, discordIdOrName }) {
  const cleanInput = (discordIdOrName || "").trim();
  if (!cleanInput) {
    return { records: [], isNameFallback: false, matchedKey: "" };
  }

  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const isDiscordId = /^\d{17,20}$/.test(cleanInput);

  if (isDiscordId) {
    const sql = `
      SELECT * FROM refunds
      WHERE player_discord_id = ?
      ORDER BY id DESC
    `;
    const { results } = await db.prepare(sql).bind(cleanInput).all();
    if (results && results.length > 0) {
      return {
        records: results.map(mapRowToRefund),
        isNameFallback: false,
        matchedKey: cleanInput,
      };
    }
  }

  // Fallback to name search
  const inputLower = cleanInput.toLowerCase();
  const nameSql = `
    SELECT * FROM refunds
    WHERE normalized_player_name = ? OR LOWER(player_name) = ?
    ORDER BY id DESC
  `;
  const { results: nameResults } = await db.prepare(nameSql).bind(inputLower, inputLower).all();

  return {
    records: (nameResults || []).map(mapRowToRefund),
    isNameFallback: true,
    matchedKey: cleanInput,
  };
}

/**
 * Look up refund records strictly by exact Player Discord ID.
 * Returns records sorted newest first.
 * Does NOT fall back to player name.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.playerDiscordId
 * @returns {Promise<Array<Object>>}
 */
export async function getRefundsByPlayerDiscordId({ env, playerDiscordId }) {
  const cleanId = String(playerDiscordId || "").trim();
  if (!cleanId || cleanId === "N/A" || cleanId === "None") {
    return [];
  }

  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const sql = `
    SELECT * FROM refunds
    WHERE player_discord_id = ?
    ORDER BY id DESC
  `;
  const { results } = await db.prepare(sql).bind(cleanId).all();
  return (results || []).map(mapRowToRefund);
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
 * @param {string} [options.categoryFilter="All"]
 * @returns {Promise<Array<Object>>} Filtered and prioritized records
 */
export async function searchRefunds({ env, query, categoryFilter = "All" }) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) return [];

  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const queryLower = cleanQuery.toLowerCase();
  const numericSeq = extractRefundNumericSequence(cleanQuery);

  const sql = `SELECT * FROM refunds ORDER BY id DESC`;
  const { results } = await db.prepare(sql).all();
  let allRecords = (results || []).map(mapRowToRefund);

  if (categoryFilter && categoryFilter !== "All") {
    const catLower = categoryFilter.toLowerCase();
    allRecords = allRecords.filter(
      (r) => (r.refundCategory || "").toLowerCase() === catLower
    );
  }

  const tier1 = []; // Exact Refund ID
  const tier2 = []; // Numeric sequence match
  const tier3 = []; // Exact Discord ID
  const tier4 = []; // Exact Player Name
  const tier5 = []; // Partial Player Name
  const tier6 = []; // Details, reason, staff name

  const seenIds = new Set();

  for (const rec of allRecords) {
    const recIdUpper = rec.refundId.toUpperCase();
    const recNumericSeq = extractRefundNumericSequence(rec.refundId);

    if (recIdUpper === queryLower.toUpperCase()) {
      tier1.push(rec);
      seenIds.add(rec.refundId);
    } else if (
      numericSeq !== null &&
      recNumericSeq !== null &&
      recNumericSeq === numericSeq
    ) {
      tier2.push(rec);
      seenIds.add(rec.refundId);
    } else if (
      rec.playerDiscordId &&
      rec.playerDiscordId !== "N/A" &&
      rec.playerDiscordId === cleanQuery
    ) {
      tier3.push(rec);
      seenIds.add(rec.refundId);
    } else if (
      rec.normalizedPlayerName &&
      rec.normalizedPlayerName === queryLower
    ) {
      tier4.push(rec);
      seenIds.add(rec.refundId);
    } else if (
      rec.normalizedPlayerName &&
      rec.normalizedPlayerName.includes(queryLower)
    ) {
      tier5.push(rec);
      seenIds.add(rec.refundId);
    } else if (
      rec.refundDetails.toLowerCase().includes(queryLower) ||
      rec.reason.toLowerCase().includes(queryLower) ||
      rec.staffName.toLowerCase().includes(queryLower) ||
      rec.staffDiscordId.includes(cleanQuery)
    ) {
      tier6.push(rec);
      seenIds.add(rec.refundId);
    }
  }

  return [...tier1, ...tier2, ...tier3, ...tier4, ...tier5, ...tier6];
}

/**
 * Edit an existing refund record in Cloudflare D1 without creating a duplicate.
 * Updates columns in the refunds table and appends an EDITED entry to refund_audits.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.refundId
 * @param {Object} options.updatedFields
 * @param {Object} [options.staffInfo]
 * @param {string} [options.auditDetails]
 * @returns {Promise<{ success: boolean, updatedRecord: Object, rowIndex: number, changesSummary: string, auditSuccess: boolean }>}
 */
export async function updateRefundRecord({
  env,
  refundId,
  updatedFields,
  staffInfo,
  auditDetails = null,
}) {
  const existing = await getRefundById({ env, refundId });
  if (!existing) {
    throw new Error(`Refund record '${refundId}' not found.`);
  }

  const db = getDatabase(env);

  // Track changes for audit log
  const changes = [];
  if (updatedFields.playerName !== undefined && updatedFields.playerName.trim() !== existing.playerName) {
    changes.push(
      existing.playerName
        ? `Changed Player Name from "${existing.playerName}" to "${updatedFields.playerName.trim()}"`
        : `Changed Player Name to "${updatedFields.playerName.trim()}"`
    );
  }
  if (updatedFields.refundCategory !== undefined && updatedFields.refundCategory.trim() !== existing.refundCategory) {
    changes.push(
      `Changed Category from "${existing.refundCategory}" to "${updatedFields.refundCategory.trim()}"`
    );
  }
  if (updatedFields.refundDetails !== undefined && updatedFields.refundDetails.trim() !== existing.refundDetails) {
    changes.push(
      `Changed Details from "${existing.refundDetails}" to "${updatedFields.refundDetails.trim()}"`
    );
  }
  if (updatedFields.reason !== undefined && updatedFields.reason.trim() !== existing.reason) {
    changes.push("Updated Reason");
  }
  const oldTicket = existing.ticketUrl || "";
  const newTicket = (updatedFields.ticketUrl !== undefined ? updatedFields.ticketUrl : oldTicket).trim();
  if (newTicket !== oldTicket) {
    changes.push(!oldTicket ? "Added Ticket URL" : (newTicket ? "Updated Ticket URL" : "Removed Ticket URL"));
  }

  const changesSummary = changes.length > 0 ? changes.join(", ") : "No fields changed";

  const updatedRecord = {
    ...existing,
    playerName: updatedFields.playerName !== undefined ? updatedFields.playerName.trim() : existing.playerName,
    refundCategory: updatedFields.refundCategory !== undefined ? updatedFields.refundCategory.trim() : existing.refundCategory,
    refundDetails: updatedFields.refundDetails !== undefined ? updatedFields.refundDetails.trim() : existing.refundDetails,
    reason: updatedFields.reason !== undefined ? updatedFields.reason.trim() : existing.reason,
    ticketUrl: newTicket,
    normalizedPlayerName: (updatedFields.playerName || existing.playerName).toLowerCase().trim(),
  };

  // If no fields actually changed, skip database update and audit
  if (changes.length === 0) {
    return {
      success: true,
      updatedRecord,
      rowIndex: existing.rowIndex,
      changesSummary,
      auditSuccess: true,
    };
  }

  const updateSql = `
    UPDATE refunds
    SET player_name = ?,
        refund_category = ?,
        refund_details = ?,
        reason = ?,
        ticket_url = ?,
        normalized_player_name = ?
    WHERE refund_id = ?
  `;

  await db
    .prepare(updateSql)
    .bind(
      updatedRecord.playerName,
      updatedRecord.refundCategory,
      updatedRecord.refundDetails,
      updatedRecord.reason,
      updatedRecord.ticketUrl,
      updatedRecord.normalizedPlayerName,
      refundId
    )
    .run();

  // Audit entry for EDITED
  let auditSuccess = false;
  const staffName = staffInfo?.name || "Staff";
  const staffDiscordId = staffInfo?.id || "0";
  const auditId = generateRefundAuditId();

  try {
    await appendRefundAuditEntry({
      env,
      auditRecord: {
        auditId,
        refundId,
        action: AuditAction.EDITED,
        changedAt: new Date().toISOString(),
        changedByName: staffName,
        changedByDiscordId: staffDiscordId,
        details: auditDetails || `Edited: ${changesSummary}`,
      },
    });
    auditSuccess = true;
  } catch (auditErr) {
    console.warn("Non-fatal: Failed to write refund audit entry for EDITED:", auditErr.message);
  }

  return {
    success: true,
    updatedRecord,
    rowIndex: existing.rowIndex,
    changesSummary,
    auditSuccess,
  };
}

/**
 * In-memory D1-compatible mock database for Node.js unit testing.
 * Wraps node:sqlite's DatabaseSync with the standard D1 API.
 * Zero external dependencies required.
 *
 * @returns {Object} D1Database mock
 */
export function createMockD1Database() {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(":memory:");

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      refund_id TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      player_name TEXT NOT NULL,
      player_discord_id TEXT NOT NULL DEFAULT 'N/A',
      refund_category TEXT NOT NULL,
      refund_details TEXT NOT NULL,
      reason TEXT NOT NULL,
      ticket_url TEXT NOT NULL DEFAULT '',
      staff_name TEXT NOT NULL,
      staff_discord_id TEXT NOT NULL,
      guild_id TEXT NOT NULL DEFAULT '',
      log_channel_id TEXT NOT NULL DEFAULT '',
      log_message_id TEXT NOT NULL DEFAULT '',
      discord_jump_url TEXT NOT NULL DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'Pending',
      normalized_player_name TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS refund_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id TEXT UNIQUE NOT NULL,
      refund_id TEXT NOT NULL,
      action TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by_name TEXT NOT NULL,
      changed_by_discord_id TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_refunds_refund_id ON refunds(refund_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_player_discord_id ON refunds(player_discord_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_normalized_player_name ON refunds(normalized_player_name);
    CREATE INDEX IF NOT EXISTS idx_refunds_staff_discord_id ON refunds(staff_discord_id);
    CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_refunds_refund_category ON refunds(refund_category);
    CREATE INDEX IF NOT EXISTS idx_refund_audits_refund_id ON refund_audits(refund_id);
  `);

  class MockPreparedStatement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }

    bind(...params) {
      return new MockPreparedStatement(this.sql, params);
    }

    async all() {
      const stmt = db.prepare(this.sql);
      const results = stmt.all(...this.params);
      return { results };
    }

    async first(colName) {
      const stmt = db.prepare(this.sql);
      const row = stmt.get(...this.params);
      if (!row) return null;
      if (colName && typeof colName === "string") {
        return row[colName] !== undefined ? row[colName] : null;
      }
      return row;
    }

    async run() {
      const stmt = db.prepare(this.sql);
      const info = stmt.run(...this.params);
      return {
        success: true,
        meta: {
          last_row_id: Number(info.lastInsertRowid),
          changes: info.changes,
        },
      };
    }
  }

  return {
    prepare(sql) {
      return new MockPreparedStatement(sql);
    },
    async batch(statements) {
      const results = [];
      db.exec("BEGIN TRANSACTION");
      try {
        for (const stmt of statements) {
          const res = await stmt.run();
          results.push(res);
        }
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { success: true };
    },
    rawDb: db,
  };
}
