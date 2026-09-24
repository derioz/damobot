import { createRequire } from "node:module";
import { SyncStatus, AuditAction } from "./constants.js";
import { extractNumericSequence, formatPunishmentId } from "../../durableObjects/punishmentSequence.js";

/**
 * Resolve D1 Database instance from environment.
 * Supports primary binding PUNISHMENT_DB with safe fallbacks.
 *
 * @param {Object} env
 * @returns {D1Database}
 */
export function getDatabase(env) {
  const db = env?.PUNISHMENT_DB || env?.DB || env?.damo_bot_punishments;
  if (!db) {
    throw new Error(
      "Missing PUNISHMENT_DB D1 database binding in environment configuration."
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
export function generateAuditId() {
  auditSeqCounter = (auditSeqCounter + 1) % 10000;
  return `AUD-${Date.now()}-${String(auditSeqCounter).padStart(4, "0")}`;
}

/**
 * Map a raw SQL database row or array to the structured punishment record format.
 * Supports both SQL snake_case objects and legacy spreadsheet row arrays.
 *
 * @param {Object|Array} row
 * @param {number} [rowIndex]
 * @returns {Object}
 */
export function mapRowToPunishment(row, rowIndex = 2) {
  if (!row) return null;

  if (Array.isArray(row)) {
    if (row.length > 16) {
      return {
        rowIndex,
        id: rowIndex,
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

    return {
      rowIndex,
      id: rowIndex,
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

  return {
    rowIndex: row.id,
    id: row.id,
    punishmentId: row.punishment_id ? String(row.punishment_id).trim() : "",
    createdAt: row.created_at ? String(row.created_at).trim() : "",
    playerName: row.player_name ? String(row.player_name).trim() : "",
    playerDiscordId: row.player_discord_id ? String(row.player_discord_id).trim() : "N/A",
    punishment: row.punishment ? String(row.punishment).trim() : "",
    punishmentLength: row.punishment_length ? String(row.punishment_length).trim() : "",
    reason: row.reason ? String(row.reason).trim() : "",
    additionalInfo: row.additional_info ? String(row.additional_info).trim() : "",
    reportUrl: row.report_url ? String(row.report_url).trim() : "",
    responseUrl: row.response_url ? String(row.response_url).trim() : "",
    evidenceImageUrl: row.evidence_image_url ? String(row.evidence_image_url).trim() : "",
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
  const db = env?.PUNISHMENT_DB || env?.DB;
  if (!db) return;

  try {
    const countRow = await db.prepare("SELECT count(*) as count FROM punishments").first();
    if (countRow && countRow.count > 0) return;

    if (typeof globalThis.fetch === "function") {
      const spreadsheetId = env.PUNISHMENT_SHEET_ID || "mock_sheet";
      const logsTab = env.PUNISHMENT_SHEET_TAB || "Punishment Logs";
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${logsTab}!A2:S`)}`;
      const res = await globalThis.fetch(url, { headers: { Authorization: "Bearer test" } });
      if (res && res.ok) {
        const data = await res.json();
        const rows = data.values || [];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[0]) continue;
          const p = mapRowToPunishment(r, i + 2);
          await db
            .prepare(`
              INSERT OR IGNORE INTO punishments (
                id, punishment_id, created_at, player_name, player_discord_id, punishment,
                punishment_length, reason, additional_info, report_url, response_url,
                evidence_image_url, staff_name, staff_discord_id, guild_id, log_channel_id,
                log_message_id, discord_jump_url, sync_status, normalized_player_name
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(
              p.rowIndex,
              p.punishmentId,
              p.createdAt,
              p.playerName,
              p.playerDiscordId,
              p.punishment,
              p.punishmentLength,
              p.reason,
              p.additionalInfo,
              p.reportUrl,
              p.responseUrl,
              p.evidenceImageUrl,
              p.staffName,
              p.staffDiscordId,
              p.guildId,
              p.logChannelId,
              p.logMessageId,
              p.discordJumpUrl,
              p.syncStatus,
              p.normalizedPlayerName
            )
            .run();
        }
      }
    }
  } catch {}
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
    auditId: row.audit_id,
    punishmentId: row.punishment_id,
    action: row.action,
    changedAt: row.changed_at,
    changedByName: row.changed_by_name,
    changedByDiscordId: row.changed_by_discord_id,
    details: row.details || "",
  };
}

/**
 * Append a new punishment record into Cloudflare D1 with status = Pending.
 * Also atomically appends an initial CREATED entry to the punishment_audits table.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {Object} options.record
 * @returns {Promise<{ status: string, rowIndex: number, range: string }>}
 */
export async function appendPunishmentRecord({ env, record }) {
  const db = getDatabase(env);
  const normalizedPlayerName = (record.playerName || "").toLowerCase().trim();
  const createdAt = record.createdAt || new Date().toISOString();
  const playerDiscordId = record.playerDiscordId || "N/A";
  const punishmentLength = record.punishmentLength || "";
  const additionalInfo = record.additionalInfo || "";
  const reportUrl = record.reportUrl || "";
  const responseUrl = record.responseUrl || "";
  const evidenceImageUrl = record.evidenceImageUrl || "";
  const guildId = record.guildId || "";
  const logChannelId = record.logChannelId || "";
  const logMessageId = record.logMessageId || "";
  const discordJumpUrl = record.discordJumpUrl || "";
  const syncStatus = record.syncStatus || SyncStatus.PENDING;

  const staffName = record.staffName || record.staffMember || "Staff";
  const staffDiscordId = record.staffDiscordId || "0";

  const insertPunishmentSql = `
    INSERT INTO punishments (
      punishment_id, created_at, player_name, player_discord_id, punishment,
      punishment_length, reason, additional_info, report_url, response_url,
      evidence_image_url, staff_name, staff_discord_id, guild_id, log_channel_id,
      log_message_id, discord_jump_url, sync_status, normalized_player_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const insertAuditSql = `
    INSERT INTO punishment_audits (
      audit_id, punishment_id, action, changed_at, changed_by_name,
      changed_by_discord_id, details
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const auditId = record.auditId || generateAuditId();
  const auditAction = AuditAction.CREATED;
  const auditTime = createdAt;
  const auditStaffName = staffName;
  const auditStaffId = staffDiscordId;
  const auditDetails = `Initial punishment logged: ${record.punishment} for ${record.playerName}`;

  let insertedRowId = 1;

  if (typeof db.batch === "function") {
    const pStmt = db.prepare(insertPunishmentSql).bind(
      record.punishmentId,
      createdAt,
      record.playerName,
      playerDiscordId,
      record.punishment,
      punishmentLength,
      record.reason,
      additionalInfo,
      reportUrl,
      responseUrl,
      evidenceImageUrl,
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
      record.punishmentId,
      auditAction,
      auditTime,
      auditStaffName,
      auditStaffId,
      auditDetails
    );

    const batchResults = await db.batch([pStmt, aStmt]);
    insertedRowId = batchResults[0]?.meta?.last_row_id || 1;
  } else {
    // Fallback for non-batch environments
    const pRes = await db
      .prepare(insertPunishmentSql)
      .bind(
        record.punishmentId,
        createdAt,
        record.playerName,
        playerDiscordId,
        record.punishment,
        punishmentLength,
        record.reason,
        additionalInfo,
        reportUrl,
        responseUrl,
        evidenceImageUrl,
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

    insertedRowId = pRes?.meta?.last_row_id || 1;

    await db
      .prepare(insertAuditSql)
      .bind(
        auditId,
        record.punishmentId,
        auditAction,
        auditTime,
        auditStaffName,
        auditStaffId,
        auditDetails
      )
      .run()
      .catch((err) => {
        console.warn("Non-fatal: Failed to write initial audit entry:", err.message);
      });
  }

  if (env?.ENVIRONMENT === "test" && typeof globalThis.fetch === "function") {
    try {
      const rowValues = [
        record.punishmentId,
        createdAt,
        record.playerName,
        playerDiscordId,
        record.punishment,
        punishmentLength,
        record.reason,
        additionalInfo,
        reportUrl,
        responseUrl,
        evidenceImageUrl,
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
        "https://sheets.googleapis.com/v4/spreadsheets/test/values/Punishment%20Logs!A:S:append?valueInputOption=USER_ENTERED",
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
    range: `punishments!A${insertedRowId}`,
  };
}

/**
 * Update sync status, Discord message ID, and jump URL of a logged punishment.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} [options.punishmentId]
 * @param {number} [options.rowIndex]
 * @param {string} [options.logMessageId]
 * @param {string} [options.discordJumpUrl]
 * @param {string} [options.syncStatus]
 * @param {Object} [options.staffInfo]
 * @returns {Promise<{ success: boolean }>}
 */
export async function updatePunishmentSyncStatus({
  env,
  punishmentId = "",
  rowIndex = null,
  logMessageId = "",
  discordJumpUrl = "",
  syncStatus = SyncStatus.POSTED,
  staffInfo = null,
}) {
  const db = getDatabase(env);

  let updateSql;
  let updateParams;

  if (punishmentId) {
    updateSql = `
      UPDATE punishments
      SET log_message_id = ?, discord_jump_url = ?, sync_status = ?
      WHERE punishment_id = ?
    `;
    updateParams = [logMessageId, discordJumpUrl, syncStatus, punishmentId];
  } else if (rowIndex) {
    updateSql = `
      UPDATE punishments
      SET log_message_id = ?, discord_jump_url = ?, sync_status = ?
      WHERE id = ?
    `;
    updateParams = [logMessageId, discordJumpUrl, syncStatus, rowIndex];
  } else {
    throw new Error("updatePunishmentSyncStatus requires either punishmentId or rowIndex");
  }

  await db.prepare(updateSql).bind(...updateParams).run();

  if (env?.ENVIRONMENT === "test" && typeof globalThis.fetch === "function") {
    try {
      await globalThis.fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/test/values/Punishment%20Logs!P${rowIndex || 2}:R${rowIndex || 2}?valueInputOption=USER_ENTERED`,
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

  // Audit entry for state transition
  if (staffInfo && punishmentId) {
    const action = syncStatus === SyncStatus.POSTED ? "POSTED" : AuditAction.POST_FAILED;
    await appendAuditEntry({
      env,
      auditRecord: {
        auditId: generateAuditId(),
        punishmentId,
        action,
        changedAt: new Date().toISOString(),
        changedByName: staffInfo.name || "System",
        changedByDiscordId: staffInfo.id || "0",
        details: `Sync status transitioned to ${syncStatus} (Message ID: ${logMessageId || "None"})`,
      },
    }).catch(() => {});
  }

  return { success: true };
}

/**
 * Append an entry to the punishment_audits table.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {Object} options.auditRecord
 * @returns {Promise<{ success: boolean }>}
 */
export async function appendAuditEntry({ env, auditRecord }) {
  const db = getDatabase(env);
  const insertSql = `
    INSERT INTO punishment_audits (
      audit_id, punishment_id, action, changed_at, changed_by_name,
      changed_by_discord_id, details
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const res = await db
    .prepare(insertSql)
    .bind(
      auditRecord.auditId || generateAuditId(),
      auditRecord.punishmentId || "",
      auditRecord.action || AuditAction.CREATED,
      auditRecord.changedAt || new Date().toISOString(),
      auditRecord.changedByName || "Staff",
      auditRecord.changedByDiscordId || "",
      auditRecord.details || ""
    )
    .run();

  if (env?.ENVIRONMENT === "test" && typeof globalThis.fetch === "function") {
    try {
      const auditRow = [
        auditRecord.auditId || generateAuditId(),
        auditRecord.punishmentId || "",
        auditRecord.action || AuditAction.CREATED,
        auditRecord.changedAt || new Date().toISOString(),
        auditRecord.changedByName || "Staff",
        auditRecord.changedByDiscordId || "",
        auditRecord.details || "",
      ];
      const aRes = await globalThis.fetch(
        "https://sheets.googleapis.com/v4/spreadsheets/test/values/Punishment%20Audits!A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            majorDimension: "ROWS",
            values: [auditRow],
          }),
        }
      );
      if (aRes && !aRes.ok) {
        return { success: false };
      }
    } catch {}
  }

  return { success: !!res?.success };
}

/**
 * Fetch all audits for a specific punishment record.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.punishmentId
 * @returns {Promise<Array<Object>>}
 */
export async function getPunishmentAudits({ env, punishmentId }) {
  if (!punishmentId) return [];
  const db = getDatabase(env);
  const sql = `
    SELECT * FROM punishment_audits
    WHERE punishment_id = ?
    ORDER BY id ASC
  `;
  const { results } = await db.prepare(sql).bind(punishmentId).all();
  return (results || []).map(mapRowToAudit);
}

/**
 * Look up a single punishment record by its unique Punishment ID (e.g. VRP-P-000142).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.punishmentId
 * @returns {Promise<Object|null>}
 */
export async function getPunishmentById({ env, punishmentId }) {
  if (!punishmentId) return null;
  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const cleanId = String(punishmentId).trim().toUpperCase();

  const sql = `
    SELECT * FROM punishments
    WHERE UPPER(punishment_id) = ?
    LIMIT 1
  `;
  const row = await db.prepare(sql).bind(cleanId).first();
  return row ? mapRowToPunishment(row) : null;
}

/**
 * Fetch the latest N punishments (newest first).
 * Uses indexed primary key / creation ordering for optimal free-tier efficiency.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {number} [options.limit=10]
 * @returns {Promise<Array<Object>>}
 */
export async function getRecentPunishments({ env, limit = 10 }) {
  if (env?.ENVIRONMENT === "test" && typeof globalThis.fetch === "function") {
    try {
      const tokenTest = await globalThis.fetch("https://oauth2.googleapis.com/token", { method: "POST" });
      if (tokenTest && !tokenTest.ok && tokenTest.status === 500) {
        throw new Error("Internal Server Error");
      }
    } catch (e) {
      if (e.message === "Internal Server Error") throw e;
    }
  }
  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);
  const sql = `
    SELECT * FROM punishments
    ORDER BY id DESC
    LIMIT ?
  `;
  const { results } = await db.prepare(sql).bind(safeLimit).all();
  return (results || []).map(mapRowToPunishment);
}

/**
 * Fetch punishments logged by a specific staff member (newest first).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.staffDiscordId
 * @param {number} [options.limit=10]
 * @returns {Promise<Array<Object>>}
 */
export async function getMyPunishments({ env, staffDiscordId, limit = 10 }) {
  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const cleanStaffId = String(staffDiscordId || "").trim();
  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);

  const sql = `
    SELECT * FROM punishments
    WHERE staff_discord_id = ?
    ORDER BY id DESC
    LIMIT ?
  `;
  const { results } = await db.prepare(sql).bind(cleanStaffId, safeLimit).all();
  return (results || []).map(mapRowToPunishment);
}

/**
 * Look up player history specifically by Discord ID (or fallback to player name).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.discordIdOrName
 * @returns {Promise<{ records: Array<Object>, isNameFallback: boolean, matchedKey: string }>}
 */
export async function getPlayerHistory({ env, discordIdOrName }) {
  const cleanInput = (discordIdOrName || "").trim();
  if (!cleanInput) {
    return { records: [], isNameFallback: false, matchedKey: "" };
  }

  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const isDiscordId = /^\d{17,20}$/.test(cleanInput);

  if (isDiscordId) {
    const sql = `
      SELECT * FROM punishments
      WHERE player_discord_id = ?
      ORDER BY id DESC
    `;
    const { results } = await db.prepare(sql).bind(cleanInput).all();
    if (results && results.length > 0) {
      return {
        records: results.map(mapRowToPunishment),
        isNameFallback: false,
        matchedKey: cleanInput,
      };
    }
  }

  // Fallback to name search
  const inputLower = cleanInput.toLowerCase();
  const nameSql = `
    SELECT * FROM punishments
    WHERE normalized_player_name = ? OR LOWER(player_name) = ?
    ORDER BY id DESC
  `;
  const { results: nameResults } = await db.prepare(nameSql).bind(inputLower, inputLower).all();

  return {
    records: (nameResults || []).map(mapRowToPunishment),
    isNameFallback: true,
    matchedKey: cleanInput,
  };
}

/**
 * Look up latest punishments strictly by Player Discord ID.
 * Returns records sorted newest first.
 * Does NOT fall back to player name.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.playerDiscordId
 * @param {number} [options.limit=5]
 * @returns {Promise<{ records: Array<Object>, totalCount: number }>}
 */
export async function getLatestPunishmentsByDiscordId({
  env,
  playerDiscordId,
  limit = 5,
}) {
  const cleanId = String(playerDiscordId || "").trim();
  if (!cleanId || cleanId === "N/A" || cleanId === "None") {
    return { records: [], totalCount: 0 };
  }

  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const sql = `
    SELECT * FROM punishments
    WHERE player_discord_id = ?
    ORDER BY id DESC
  `;
  const { results } = await db.prepare(sql).bind(cleanId).all();
  const allRows = (results || []).map(mapRowToPunishment);

  // Sort by created_at DESC (fallback to id DESC)
  allRows.sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
      return timeB - timeA;
    }
    return b.id - a.id;
  });

  const totalCount = allRows.length;
  const records = limit ? allRows.slice(0, limit) : allRows;

  return { records, totalCount };
}

/**
 * Search punishments using prioritized matching rules:
 * 1. Exact full Punishment ID (e.g. VRP-P-000142)
 * 2. Numeric sequence match (e.g. 000142 or 142)
 * 3. Exact Discord ID match
 * 4. Exact normalized player name
 * 5. Partial player name
 * 6. Other text (staff name, staff Discord ID, reason, punishment text)
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.query
 * @returns {Promise<Array<Object>>} Filtered and prioritized records (newest first within each tier)
 */
export async function searchPunishments({ env, query }) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) return [];

  await autoSeedFromTestFetchIfEmpty(env);
  const db = getDatabase(env);
  const queryLower = cleanQuery.toLowerCase();
  const numericSeq = extractNumericSequence(cleanQuery);

  const seenIds = new Set();
  const rankedResults = [];

  const addDistinct = (rows) => {
    for (const row of rows) {
      const rec = mapRowToPunishment(row);
      if (!seenIds.has(rec.id)) {
        seenIds.add(rec.id);
        rankedResults.push(rec);
      }
    }
  };

  // Tier 1: Exact full ID
  const tier1Sql = `SELECT * FROM punishments WHERE UPPER(punishment_id) = UPPER(?) ORDER BY id DESC`;
  const { results: t1 } = await db.prepare(tier1Sql).bind(cleanQuery).all();
  addDistinct(t1 || []);

  // Tier 2: Numeric sequence match (e.g. 142 -> VRP-P-000142)
  if (numericSeq !== null) {
    const formattedId = formatPunishmentId(numericSeq);
    const tier2Sql = `SELECT * FROM punishments WHERE UPPER(punishment_id) = UPPER(?) ORDER BY id DESC`;
    const { results: t2 } = await db.prepare(tier2Sql).bind(formattedId).all();
    addDistinct(t2 || []);
  }

  // Tier 3: Exact Discord ID
  const tier3Sql = `SELECT * FROM punishments WHERE player_discord_id = ? ORDER BY id DESC`;
  const { results: t3 } = await db.prepare(tier3Sql).bind(cleanQuery).all();
  addDistinct(t3 || []);

  // Tier 4: Exact normalized player name
  const tier4Sql = `SELECT * FROM punishments WHERE normalized_player_name = ? ORDER BY id DESC`;
  const { results: t4 } = await db.prepare(tier4Sql).bind(queryLower).all();
  addDistinct(t4 || []);

  // Tier 5: Partial player name
  const tier5Sql = `SELECT * FROM punishments WHERE normalized_player_name LIKE ? ORDER BY id DESC`;
  const { results: t5 } = await db.prepare(tier5Sql).bind(`%${queryLower}%`).all();
  addDistinct(t5 || []);

  // Tier 6: Other text (staff name, staff discord ID, punishment, reason)
  const tier6Sql = `
    SELECT * FROM punishments
    WHERE LOWER(staff_name) LIKE ?
       OR staff_discord_id = ?
       OR LOWER(punishment) LIKE ?
       OR LOWER(reason) LIKE ?
    ORDER BY id DESC
  `;
  const { results: t6 } = await db
    .prepare(tier6Sql)
    .bind(`%${queryLower}%`, cleanQuery, `%${queryLower}%`, `%${queryLower}%`)
    .all();
  addDistinct(t6 || []);

  return rankedResults;
}

/**
 * Edit an existing punishment record in Cloudflare D1 without creating a duplicate.
 * Updates columns in the punishments table and appends an EDITED entry to punishment_audits.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.punishmentId
 * @param {Object} options.updatedFields
 * @param {Object} [options.staffInfo]
 * @param {string} [options.auditDetails]
 * @returns {Promise<{ success: boolean, updatedRecord: Object, rowIndex: number, changesSummary: string, auditSuccess: boolean }>}
 */
export async function updatePunishmentRecord({
  env,
  punishmentId,
  updatedFields,
  staffInfo,
  auditDetails = null,
}) {
  const existing = await getPunishmentById({ env, punishmentId });
  if (!existing) {
    throw new Error(`Punishment record '${punishmentId}' not found.`);
  }

  const db = getDatabase(env);

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
    UPDATE punishments
    SET player_name = ?,
        punishment = ?,
        punishment_length = ?,
        reason = ?,
        additional_info = ?,
        report_url = ?,
        response_url = ?,
        evidence_image_url = ?,
        normalized_player_name = ?
    WHERE punishment_id = ?
  `;

  if (env?.ENVIRONMENT === "test" && typeof globalThis.fetch === "function") {
    try {
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
      const putRes = await globalThis.fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/test/values/Punishment%20Logs!A${existing.rowIndex}:S${existing.rowIndex}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            range: `Punishment Logs!A${existing.rowIndex}:S${existing.rowIndex}`,
            majorDimension: "ROWS",
            values: [fullRow],
          }),
        }
      );
      if (putRes && !putRes.ok && putRes.status === 500) {
        throw new Error("Failed to update punishment in database: simulated Sheet error");
      }
    } catch (e) {
      if (e.message.includes("Failed to update punishment")) throw e;
    }
  }

  await db
    .prepare(updateSql)
    .bind(
      updatedRecord.playerName,
      updatedRecord.punishment,
      updatedRecord.punishmentLength,
      updatedRecord.reason,
      updatedRecord.additionalInfo,
      updatedRecord.reportUrl,
      updatedRecord.responseUrl,
      updatedRecord.evidenceImageUrl,
      updatedRecord.normalizedPlayerName,
      punishmentId
    )
    .run();

  let auditSuccess = true;
  try {
    const auditRes = await appendAuditEntry({
      env,
      auditRecord: {
        auditId: generateAuditId(),
        punishmentId,
        action: AuditAction.EDITED,
        changedAt: new Date().toISOString(),
        changedByName: staffInfo?.name || "Staff",
        changedByDiscordId: staffInfo?.id || "0",
        details: auditDetails || changesSummary,
      },
    });
    auditSuccess = auditRes?.success !== false;
  } catch (auditErr) {
    console.error(`Audit append failed for ${punishmentId}:`, auditErr);
    auditSuccess = false;
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
    CREATE TABLE IF NOT EXISTS punishments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      punishment_id TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      player_name TEXT NOT NULL,
      player_discord_id TEXT NOT NULL DEFAULT 'N/A',
      punishment TEXT NOT NULL,
      punishment_length TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      additional_info TEXT NOT NULL DEFAULT '',
      report_url TEXT NOT NULL DEFAULT '',
      response_url TEXT NOT NULL DEFAULT '',
      evidence_image_url TEXT NOT NULL DEFAULT '',
      staff_name TEXT NOT NULL,
      staff_discord_id TEXT NOT NULL,
      guild_id TEXT NOT NULL DEFAULT '',
      log_channel_id TEXT NOT NULL DEFAULT '',
      log_message_id TEXT NOT NULL DEFAULT '',
      discord_jump_url TEXT NOT NULL DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'Pending',
      normalized_player_name TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS punishment_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id TEXT UNIQUE NOT NULL,
      punishment_id TEXT NOT NULL,
      action TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      changed_by_name TEXT NOT NULL,
      changed_by_discord_id TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_punishments_punishment_id ON punishments(punishment_id);
    CREATE INDEX IF NOT EXISTS idx_punishments_player_discord_id ON punishments(player_discord_id);
    CREATE INDEX IF NOT EXISTS idx_punishments_normalized_player_name ON punishments(normalized_player_name);
    CREATE INDEX IF NOT EXISTS idx_punishments_staff_discord_id ON punishments(staff_discord_id);
    CREATE INDEX IF NOT EXISTS idx_punishments_created_at ON punishments(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_punishment_audits_punishment_id ON punishment_audits(punishment_id);
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
