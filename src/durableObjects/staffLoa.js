import { getTodayInChicago } from "../loa/dateUtils.js";
import {
  formatLoaNickname,
  stripLoaPrefix,
  computeRestoredNickname,
  modifyGuildMemberNickname,
  getGuildMember,
} from "../loa/nicknameUtils.js";
import { refreshPublicLoaList } from "../loa/loaHandler.js";
import { DEFAULT_LOA_CHANNEL_ID } from "../config/channels.js";
import { executeLoaRoleRestore, executeLoaRoleSwap } from "../loa/roleUtils.js";
import { logLoaEnded } from "../loa/loaLogger.js";

/**
 * Normalize an SQLite staff_loas database record into a clean object with parsed JSON fields.
 *
 * @param {Object} row
 * @returns {Object|null}
 */
export function normalizeLoaRecord(row) {
  if (!row) return null;

  let removedRoleIds = [];
  if (Array.isArray(row.removedRoleIds)) {
    removedRoleIds = row.removedRoleIds;
  } else if (typeof row.removed_role_ids === "string" && row.removed_role_ids) {
    try {
      removedRoleIds = JSON.parse(row.removed_role_ids);
    } catch (_) {
      removedRoleIds = [];
    }
  }

  let restoredRoleIds = [];
  if (Array.isArray(row.restoredRoleIds)) {
    restoredRoleIds = row.restoredRoleIds;
  } else if (typeof row.restored_role_ids === "string" && row.restored_role_ids) {
    try {
      restoredRoleIds = JSON.parse(row.restored_role_ids);
    } catch (_) {
      restoredRoleIds = [];
    }
  }

  let failedRestoreRoleIds = [];
  if (Array.isArray(row.failedRestoreRoleIds)) {
    failedRestoreRoleIds = row.failedRestoreRoleIds;
  } else if (
    typeof row.failed_restore_role_ids === "string" &&
    row.failed_restore_role_ids
  ) {
    try {
      failedRestoreRoleIds = JSON.parse(row.failed_restore_role_ids);
    } catch (_) {
      failedRestoreRoleIds = [];
    }
  }

  let preservedRoleIds = [];
  if (Array.isArray(row.preservedRoleIds)) {
    preservedRoleIds = row.preservedRoleIds;
  } else if (typeof row.preserved_role_ids === "string" && row.preserved_role_ids) {
    try {
      preservedRoleIds = JSON.parse(row.preserved_role_ids);
    } catch (_) {
      preservedRoleIds = [];
    }
  }

  const isProtected =
    row.is_protected_staff === 1 ||
    Boolean(row.isProtectedStaff);
  const assignedLoaRoleId =
    row.assigned_loa_role_id ||
    row.assignedLoaRoleId ||
    null;

  const isLegacy =
    row.is_legacy_snapshot === 1 ||
    Boolean(row.isLegacySnapshot) ||
    (!row.removed_role_ids && row.role_swap_status !== "completed" && !isProtected);

  return {
    ...row,
    removed_role_ids: row.removed_role_ids || null,
    restored_role_ids: row.restored_role_ids || null,
    failed_restore_role_ids: row.failed_restore_role_ids || null,
    preserved_role_ids: row.preserved_role_ids || null,
    role_swap_status: row.role_swap_status || "none",
    role_restore_status: row.role_restore_status || "none",
    role_swap_completed_at: row.role_swap_completed_at || null,
    role_restore_completed_at: row.role_restore_completed_at || null,
    role_swap_error: row.role_swap_error || null,
    role_restore_error: row.role_restore_error || null,
    is_protected_staff: isProtected ? 1 : 0,
    isProtectedStaff: isProtected,
    assigned_loa_role_id: assignedLoaRoleId,
    assignedLoaRoleId,
    removedRoleIds,
    restoredRoleIds,
    failedRestoreRoleIds,
    preservedRoleIds,
    is_legacy_snapshot: isLegacy ? 1 : 0,
    isLegacySnapshot: Boolean(isLegacy),
  };
}

/**
 * Durable Object for storing persistent Staff Leave of Absence (LOA) data.
 * Uses SQLite-backed Durable Object storage on Cloudflare Workers.
 */
export class StaffLoaDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    // In-memory fallback if sql is not available in mock/test environments
    this.memoryLoas = new Map();
    this.memoryMeta = new Map();
    this.memorySubscriptions = new Map();

    this.initDatabase();
  }

  /**
   * Initialize SQLite tables and indexes.
   */
  initDatabase() {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS staff_loas (
          id TEXT PRIMARY KEY,
          guild_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          cancelled_at TEXT,
          ended_at TEXT,
          cancelled INTEGER NOT NULL DEFAULT 0,
          ended_early INTEGER NOT NULL DEFAULT 0,
          original_nickname TEXT,
          loa_nickname TEXT,
          nickname_modified INTEGER NOT NULL DEFAULT 0,
          removed_role_ids TEXT,
          restored_role_ids TEXT,
          failed_restore_role_ids TEXT,
          preserved_role_ids TEXT,
          role_swap_status TEXT DEFAULT 'none',
          role_restore_status TEXT DEFAULT 'none',
          role_swap_completed_at TEXT,
          role_restore_completed_at TEXT,
          role_swap_error TEXT,
          role_restore_error TEXT,
          is_legacy_snapshot INTEGER NOT NULL DEFAULT 0,
          is_protected_staff INTEGER NOT NULL DEFAULT 0,
          assigned_loa_role_id TEXT
        );
      `);

      // Idempotent column additions for existing databases
      const columnAdditions = [
        "ALTER TABLE staff_loas ADD COLUMN original_nickname TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN loa_nickname TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN nickname_modified INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE staff_loas ADD COLUMN removed_role_ids TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN restored_role_ids TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN failed_restore_role_ids TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN preserved_role_ids TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN role_swap_status TEXT DEFAULT 'none';",
        "ALTER TABLE staff_loas ADD COLUMN role_restore_status TEXT DEFAULT 'none';",
        "ALTER TABLE staff_loas ADD COLUMN role_swap_completed_at TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN role_restore_completed_at TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN role_swap_error TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN role_restore_error TEXT;",
        "ALTER TABLE staff_loas ADD COLUMN is_legacy_snapshot INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE staff_loas ADD COLUMN is_protected_staff INTEGER NOT NULL DEFAULT 0;",
        "ALTER TABLE staff_loas ADD COLUMN assigned_loa_role_id TEXT;",
      ];

      for (const colSql of columnAdditions) {
        try {
          this.ctx.storage.sql.exec(colSql);
        } catch (_) {}
      }

      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS loa_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_staff_loas_guild_user ON staff_loas (guild_id, user_id);
      `);
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_staff_loas_start_date ON staff_loas (start_date);
      `);
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_staff_loas_end_date ON staff_loas (end_date);
      `);
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_staff_loas_cancelled ON staff_loas (cancelled);
      `);
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_staff_loas_ended_early ON staff_loas (ended_early);
      `);

      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS loa_subscriptions (
          loa_id TEXT NOT NULL,
          subscriber_user_id TEXT NOT NULL,
          guild_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (loa_id, subscriber_user_id)
        );
      `);
      this.ctx.storage.sql.exec(`
        CREATE INDEX IF NOT EXISTS idx_loa_subs_user ON loa_subscriptions (subscriber_user_id);
      `);
    }
  }

  /**
   * Find an active or upcoming LOA for a specific user.
   * An LOA is active or upcoming if:
   *  - cancelled = 0
   *  - ended_early = 0
   *  - ended_at IS NULL
   *  - end_date >= todayIso
   *
   * @param {string} userId
   * @param {string} todayIso (YYYY-MM-DD)
   * @returns {Object|null}
   */
  getActiveOrUpcomingLoa(userId, todayIso) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM staff_loas
         WHERE user_id = ?
           AND cancelled = 0
           AND ended_early = 0
           AND ended_at IS NULL
           AND end_date >= ?
         ORDER BY start_date ASC
         LIMIT 1`,
        userId,
        todayIso
      );
      const rows = [...cursor];
      return rows.length > 0 ? normalizeLoaRecord(rows[0]) : null;
    }

    for (const record of this.memoryLoas.values()) {
      if (
        record.user_id === userId &&
        record.cancelled === 0 &&
        record.ended_early === 0 &&
        !record.ended_at &&
        record.end_date >= todayIso
      ) {
        return normalizeLoaRecord(record);
      }
    }
    return null;
  }

  /**
   * Retrieve an LOA by its primary ID.
   * @param {string} loaId
   * @returns {Object|null}
   */
  getLoaById(loaId) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT * FROM staff_loas WHERE id = ?",
        loaId
      );
      const rows = [...cursor];
      return rows.length > 0 ? normalizeLoaRecord(rows[0]) : null;
    }
    return this.memoryLoas.get(loaId) ? normalizeLoaRecord(this.memoryLoas.get(loaId)) : null;
  }

  /**
   * Create a new LOA record.
   * Enforces that a staff member cannot create a new LOA if they already have an active or upcoming LOA.
   *
   * @param {Object} params
   * @returns {{ success: boolean, loa?: Object, error?: string }}
   */
  createLoa({
    id,
    guildId,
    userId,
    displayName,
    startDate,
    endDate,
    reason,
    todayIso,
    originalNickname = null,
    loaNickname = null,
    nicknameModified = 0,
    removedRoleIds = null,
    preservedRoleIds = null,
    roleSwapStatus = "none",
    roleSwapCompletedAt = null,
    isLegacySnapshot = 0,
    createdAt = new Date().toISOString(),
  }) {
    const existing = this.getActiveOrUpcomingLoa(userId, todayIso);
    if (existing) {
      return {
        success: false,
        error: "ALREADY_EXISTS",
        existingLoa: existing,
      };
    }

    const removedJson = removedRoleIds ? JSON.stringify(removedRoleIds) : null;
    const preservedJson = preservedRoleIds ? JSON.stringify(preservedRoleIds) : null;

    const newRecord = {
      id,
      guild_id: guildId,
      user_id: userId,
      display_name: displayName,
      start_date: startDate,
      end_date: endDate,
      reason,
      created_at: createdAt,
      updated_at: createdAt,
      cancelled_at: null,
      ended_at: null,
      cancelled: 0,
      ended_early: 0,
      original_nickname: originalNickname,
      loa_nickname: loaNickname,
      nickname_modified: nicknameModified ? 1 : 0,
      removed_role_ids: removedJson,
      restored_role_ids: null,
      failed_restore_role_ids: null,
      preserved_role_ids: preservedJson,
      role_swap_status: roleSwapStatus || "none",
      role_restore_status: "none",
      role_swap_completed_at: roleSwapCompletedAt || null,
      role_restore_completed_at: null,
      role_swap_error: null,
      role_restore_error: null,
      is_legacy_snapshot: isLegacySnapshot ? 1 : 0,
      removedRoleIds: removedRoleIds || [],
      restoredRoleIds: [],
      failedRestoreRoleIds: [],
      preservedRoleIds: preservedRoleIds || [],
    };

    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `INSERT INTO staff_loas (
          id, guild_id, user_id, display_name, start_date, end_date, reason,
          created_at, updated_at, cancelled_at, ended_at, cancelled, ended_early,
          original_nickname, loa_nickname, nickname_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newRecord.id,
        newRecord.guild_id,
        newRecord.user_id,
        newRecord.display_name,
        newRecord.start_date,
        newRecord.end_date,
        newRecord.reason,
        newRecord.created_at,
        newRecord.updated_at,
        newRecord.cancelled_at,
        newRecord.ended_at,
        newRecord.cancelled,
        newRecord.ended_early,
        newRecord.original_nickname,
        newRecord.loa_nickname,
        newRecord.nickname_modified
      );

      if (removedJson || roleSwapStatus !== "none") {
        try {
          this.ctx.storage.sql.exec(
            `UPDATE staff_loas
             SET removed_role_ids = ?, preserved_role_ids = ?, role_swap_status = ?, role_swap_completed_at = ?, is_legacy_snapshot = ?
             WHERE id = ?`,
            removedJson,
            preservedJson,
            roleSwapStatus || "none",
            roleSwapCompletedAt || null,
            isLegacySnapshot ? 1 : 0,
            id
          );
        } catch (_) {}
      }
    } else {
      this.memoryLoas.set(id, newRecord);
    }

    return {
      success: true,
      loa: normalizeLoaRecord(newRecord),
    };
  }

  /**
   * Update an existing LOA.
   * Modifies only the supplied fields and updates `updated_at`.
   *
   * @param {Object} params
   * @returns {{ success: boolean, loa?: Object, error?: string }}
   */
  updateLoa({
    loaId,
    userId,
    displayName,
    startDate,
    endDate,
    reason,
    updatedAt = new Date().toISOString(),
  }) {
    const existing = this.getLoaById(loaId);
    if (!existing || existing.user_id !== userId) {
      return { success: false, error: "NOT_FOUND" };
    }

    if (existing.cancelled || existing.ended_early || existing.ended_at) {
      return { success: false, error: "CANNOT_EDIT_CLOSED" };
    }

    const updated = {
      ...existing,
      display_name:
        displayName !== undefined && displayName !== null
          ? displayName
          : existing.display_name,
      start_date:
        startDate !== undefined && startDate !== null
          ? startDate
          : existing.start_date,
      end_date:
        endDate !== undefined && endDate !== null ? endDate : existing.end_date,
      reason:
        reason !== undefined && reason !== null ? reason : existing.reason,
      updated_at: updatedAt,
    };

    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `UPDATE staff_loas
         SET display_name = ?, start_date = ?, end_date = ?, reason = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        updated.display_name,
        updated.start_date,
        updated.end_date,
        updated.reason,
        updated.updated_at,
        loaId,
        userId
      );
    } else {
      this.memoryLoas.set(loaId, updated);
    }

    return { success: true, loa: updated };
  }

  /**
   * Update nickname tracking fields for an LOA record.
   *
   * @param {string} loaId
   * @param {Object} fields
   * @returns {{ success: boolean, loa?: Object, error?: string }}
   */
  updateLoaNicknameState(
    loaId,
    { originalNickname, loaNickname, nicknameModified }
  ) {
    const existing = this.getLoaById(loaId);
    if (!existing) return { success: false, error: "NOT_FOUND" };

    const updated = {
      ...existing,
      original_nickname:
        originalNickname !== undefined
          ? originalNickname
          : existing.original_nickname,
      loa_nickname:
        loaNickname !== undefined ? loaNickname : existing.loa_nickname,
      nickname_modified:
        nicknameModified !== undefined
          ? nicknameModified ? 1 : 0
          : existing.nickname_modified,
    };

    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `UPDATE staff_loas
         SET original_nickname = ?, loa_nickname = ?, nickname_modified = ?
         WHERE id = ?`,
        updated.original_nickname,
        updated.loa_nickname,
        updated.nickname_modified,
        loaId
      );
    } else {
      this.memoryLoas.set(loaId, updated);
    }

    return { success: true, loa: updated };
  }

  /**
   * Update role snapshot fields for an LOA record.
   *
   * @param {string} loaId
   * @param {Object} fields
   * @returns {{ success: boolean, loa?: Object, error?: string }}
   */
  updateLoaRoleSnapshot(
    loaId,
    {
      removedRoleIds,
      preservedRoleIds,
      roleSwapStatus,
      roleSwapCompletedAt,
      roleSwapError,
      isProtectedStaff,
      assignedLoaRoleId,
    }
  ) {
    const existing = this.getLoaById(loaId);
    if (!existing) return { success: false, error: "NOT_FOUND" };

    const removedJson =
      removedRoleIds !== undefined
        ? JSON.stringify(removedRoleIds)
        : existing.removed_role_ids || null;
    const preservedJson =
      preservedRoleIds !== undefined
        ? JSON.stringify(preservedRoleIds)
        : existing.preserved_role_ids || null;
    const status =
      roleSwapStatus !== undefined
        ? roleSwapStatus
        : existing.role_swap_status || "none";
    const completedAt =
      roleSwapCompletedAt !== undefined
        ? roleSwapCompletedAt
        : existing.role_swap_completed_at || null;
    const errorVal =
      roleSwapError !== undefined
        ? roleSwapError
        : existing.role_swap_error || null;
    const isProtectedVal =
      isProtectedStaff !== undefined
        ? (isProtectedStaff ? 1 : 0)
        : (existing.is_protected_staff || 0);
    const assignedLoaRoleIdVal =
      assignedLoaRoleId !== undefined
        ? assignedLoaRoleId
        : (existing.assigned_loa_role_id || null);

    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `UPDATE staff_loas
         SET removed_role_ids = ?, preserved_role_ids = ?, role_swap_status = ?, role_swap_completed_at = ?, role_swap_error = ?, is_protected_staff = ?, assigned_loa_role_id = ?
         WHERE id = ?`,
        removedJson,
        preservedJson,
        status,
        completedAt,
        errorVal,
        isProtectedVal,
        assignedLoaRoleIdVal,
        loaId
      );
    }

    const updated = {
      ...existing,
      removed_role_ids: removedJson,
      preserved_role_ids: preservedJson,
      role_swap_status: status,
      role_swap_completed_at: completedAt,
      role_swap_error: errorVal,
      is_protected_staff: isProtectedVal,
      isProtectedStaff: Boolean(isProtectedVal),
      assigned_loa_role_id: assignedLoaRoleIdVal,
      assignedLoaRoleId: assignedLoaRoleIdVal,
      removedRoleIds:
        removedRoleIds !== undefined ? removedRoleIds : existing.removedRoleIds,
      preservedRoleIds:
        preservedRoleIds !== undefined
          ? preservedRoleIds
          : existing.preservedRoleIds,
    };
    this.memoryLoas.set(loaId, updated);

    return { success: true, loa: normalizeLoaRecord(updated) };
  }

  /**
   * Update role restoration fields for an LOA record.
   *
   * @param {string} loaId
   * @param {Object} fields
   * @returns {{ success: boolean, loa?: Object, error?: string }}
   */
  updateLoaRoleRestoration(
    loaId,
    {
      restoredRoleIds,
      failedRestoreRoleIds,
      roleRestoreStatus,
      roleRestoreCompletedAt,
      roleRestoreError,
      isLegacySnapshot,
    }
  ) {
    const existing = this.getLoaById(loaId);
    if (!existing) return { success: false, error: "NOT_FOUND" };

    const restoredJson =
      restoredRoleIds !== undefined
        ? JSON.stringify(restoredRoleIds)
        : existing.restored_role_ids || null;
    const failedJson =
      failedRestoreRoleIds !== undefined
        ? JSON.stringify(failedRestoreRoleIds)
        : existing.failed_restore_role_ids || null;
    const status =
      roleRestoreStatus !== undefined
        ? roleRestoreStatus
        : existing.role_restore_status || "none";
    const completedAt =
      roleRestoreCompletedAt !== undefined
        ? roleRestoreCompletedAt
        : existing.role_restore_completed_at || null;
    const errorVal =
      roleRestoreError !== undefined
        ? roleRestoreError
        : existing.role_restore_error || null;
    const legacyVal =
      isLegacySnapshot !== undefined
        ? isLegacySnapshot ? 1 : 0
        : existing.is_legacy_snapshot ? 1 : 0;

    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `UPDATE staff_loas
         SET restored_role_ids = ?, failed_restore_role_ids = ?, role_restore_status = ?, role_restore_completed_at = ?, role_restore_error = ?, is_legacy_snapshot = ?
         WHERE id = ?`,
        restoredJson,
        failedJson,
        status,
        completedAt,
        errorVal,
        legacyVal,
        loaId
      );
    }

    const updated = {
      ...existing,
      restored_role_ids: restoredJson,
      failed_restore_role_ids: failedJson,
      role_restore_status: status,
      role_restore_completed_at: completedAt,
      role_restore_error: errorVal,
      is_legacy_snapshot: legacyVal,
      restoredRoleIds:
        restoredRoleIds !== undefined
          ? restoredRoleIds
          : existing.restoredRoleIds,
      failedRestoreRoleIds:
        failedRestoreRoleIds !== undefined
          ? failedRestoreRoleIds
          : existing.failedRestoreRoleIds,
      isLegacySnapshot: Boolean(legacyVal),
    };
    this.memoryLoas.set(loaId, updated);

    return { success: true, loa: normalizeLoaRecord(updated) };
  }

  /**
   * Retrieve all LOAs for a specific user (both active and past), ordered newest first.
   *
   * @param {string} userId
   * @returns {Array<Object>}
   */
  getLoaHistoryForUser(userId) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM staff_loas WHERE user_id = ? ORDER BY created_at DESC`,
        userId
      );
      return [...cursor].map(normalizeLoaRecord);
    }

    const list = [];
    for (const rec of this.memoryLoas.values()) {
      if (rec.user_id === userId) {
        list.push(normalizeLoaRecord(rec));
      }
    }
    list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return list;
  }

  /**
   * Retrieve recent LOAs across the server for admin auditing.
   *
   * @param {Object} options
   * @param {number} [options.limit=25]
   * @param {number} [options.offset=0]
   * @returns {Array<Object>}
   */
  getAllLoasHistory({ limit = 25, offset = 0 } = {}) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM staff_loas ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        limit,
        offset
      );
      return [...cursor].map(normalizeLoaRecord);
    }

    const list = Array.from(this.memoryLoas.values()).map(normalizeLoaRecord);
    list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return list.slice(offset, offset + limit);
  }

  /**
   * Find LOAs that have ended (by date, cancelled, or ended early) where role restoration has not yet completed.
   *
   * @param {string} todayIso
   * @returns {Array<Object>}
   */
  getLoasNeedingRoleRestoration(todayIso) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM staff_loas
         WHERE (end_date < ? OR cancelled = 1 OR ended_early = 1 OR ended_at IS NOT NULL)
           AND (role_restore_status IS NULL OR role_restore_status = 'none' OR role_restore_status = 'pending')
           AND role_swap_status = 'completed'
         ORDER BY end_date ASC`,
        todayIso
      );
      return [...cursor].map(normalizeLoaRecord);
    }

    const list = [];
    for (const record of this.memoryLoas.values()) {
      if (
        (record.end_date < todayIso ||
          record.cancelled === 1 ||
          record.ended_early === 1 ||
          record.ended_at) &&
        (!record.role_restore_status ||
          record.role_restore_status === "none" ||
          record.role_restore_status === "pending") &&
        record.role_swap_status === "completed"
      ) {
        list.push(normalizeLoaRecord(record));
      }
    }
    return list;
  }


  /**
   * Mark an upcoming LOA as cancelled.
   * Preserves record in history.
   *
   * @param {Object} params
   * @returns {{ success: boolean, loa?: Object, error?: string }}
   */
  cancelLoa({ loaId, userId, cancelledAt = new Date().toISOString() }) {
    const existing = this.getLoaById(loaId);
    if (!existing || existing.user_id !== userId) {
      return { success: false, error: "NOT_FOUND" };
    }

    const updated = {
      ...existing,
      cancelled: 1,
      cancelled_at: cancelledAt,
      updated_at: cancelledAt,
    };

    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `UPDATE staff_loas
         SET cancelled = 1, cancelled_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        cancelledAt,
        cancelledAt,
        loaId,
        userId
      );
    } else {
      this.memoryLoas.set(loaId, updated);
    }

    this.notifySubscribers({
      loa: existing,
      reasonText: "cancelled their upcoming LOA",
    });

    return { success: true, loa: updated };
  }

  /**
   * Mark an active LOA as ended early.
   * Preserves record in history.
   *
   * @param {Object} params
   * @returns {{ success: boolean, loa?: Object, error?: string }}
   */
  endLoaEarly({ loaId, userId, endedAt = new Date().toISOString() }) {
    const existing = this.getLoaById(loaId);
    if (!existing || existing.user_id !== userId) {
      return { success: false, error: "NOT_FOUND" };
    }

    const updated = {
      ...existing,
      ended_early: 1,
      ended_at: endedAt,
      updated_at: endedAt,
    };

    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `UPDATE staff_loas
         SET ended_early = 1, ended_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        endedAt,
        endedAt,
        loaId,
        userId
      );
    } else {
      this.memoryLoas.set(loaId, updated);
    }

    this.notifySubscribers({
      loa: existing,
      reasonText: "returned from LOA early",
    });

    return { success: true, loa: updated };
  }

  /**
   * Retrieve all staff members currently on active LOA.
   * Criteria:
   *  - start_date <= todayIso
   *  - end_date >= todayIso
   *  - cancelled = 0
   *  - ended_early = 0
   *  - ended_at IS NULL
   *
   * Sorted by end_date ASC (person returning soonest first), then start_date ASC.
   *
   * @param {string} todayIso (YYYY-MM-DD)
   * @returns {Array<Object>}
   */
  getActiveLoasList(todayIso) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM staff_loas
         WHERE end_date >= ?
           AND cancelled = 0
           AND ended_early = 0
           AND ended_at IS NULL
         ORDER BY (CASE WHEN start_date <= ? THEN 0 ELSE 1 END) ASC, end_date ASC, start_date ASC`,
        todayIso,
        todayIso
      );
      return [...cursor].map(normalizeLoaRecord);
    }

    const activeList = [];
    for (const record of this.memoryLoas.values()) {
      if (
        record.end_date >= todayIso &&
        record.cancelled === 0 &&
        record.ended_early === 0 &&
        !record.ended_at
      ) {
        activeList.push(normalizeLoaRecord(record));
      }
    }

    activeList.sort((a, b) => {
      const aActive = a.start_date <= todayIso ? 0 : 1;
      const bActive = b.start_date <= todayIso ? 0 : 1;
      if (aActive !== bActive) {
        return aActive - bActive;
      }
      if (a.end_date !== b.end_date) {
        return a.end_date.localeCompare(b.end_date);
      }
      return a.start_date.localeCompare(b.start_date);
    });

    return activeList;
  }

  /**
   * Find LOAs that have become active on or before todayIso and have not yet had their nickname updated.
   * @param {string} todayIso
   * @returns {Array<Object>}
   */
  getLoasNeedingNicknameActivation(todayIso) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM staff_loas
         WHERE start_date <= ?
           AND end_date >= ?
           AND cancelled = 0
           AND ended_early = 0
           AND ended_at IS NULL
           AND (nickname_modified = 0 OR nickname_modified IS NULL)
         ORDER BY start_date ASC`,
        todayIso,
        todayIso
      );
      return [...cursor];
    }

    const list = [];
    for (const record of this.memoryLoas.values()) {
      if (
        record.start_date <= todayIso &&
        record.end_date >= todayIso &&
        record.cancelled === 0 &&
        record.ended_early === 0 &&
        !record.ended_at &&
        !record.nickname_modified
      ) {
        list.push({ ...record });
      }
    }
    return list;
  }

  /**
   * Find LOAs whose nickname was modified by Damo Bot but whose LOA is now completed, cancelled, or ended early.
   * @param {string} todayIso
   * @returns {Array<Object>}
   */
  getLoasNeedingNicknameRestoration(todayIso) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM staff_loas
         WHERE nickname_modified = 1
           AND (end_date < ? OR cancelled = 1 OR ended_early = 1 OR ended_at IS NOT NULL)
         ORDER BY end_date ASC`,
        todayIso
      );
      return [...cursor];
    }

    const list = [];
    for (const record of this.memoryLoas.values()) {
      if (
        record.nickname_modified === 1 &&
        (record.end_date < todayIso ||
          record.cancelled === 1 ||
          record.ended_early === 1 ||
          record.ended_at)
      ) {
        list.push({ ...record });
      }
    }
    return list;
  }

  /**
   * Periodic date-rollover cron job handler to activate or restore member nicknames.
   * Reuses existing Cloudflare cron trigger.
   *
   * @param {Object} options
   * @param {Object} [options.env=this.env]
   * @param {string} [options.todayIso=getTodayInChicago()]
   * @param {Function} [options.customFetch=fetch]
   * @returns {Promise<Object>}
   */
  async processCronRollover({
    env = this.env,
    todayIso = getTodayInChicago(),
    customFetch = fetch,
  } = {}) {
    let modifiedCount = 0;

    // 1. Activate nicknames and role swap for LOAs that started
    const toActivate = this.getLoasNeedingNicknameActivation(todayIso);
    for (const loa of toActivate) {
      try {
        let origNick = loa.original_nickname;
        if (origNick === undefined || origNick === null) {
          const memberRes = await getGuildMember({
            env,
            guildId: loa.guild_id,
            userId: loa.user_id,
            customFetch,
          });
          origNick = memberRes.success ? memberRes.member?.nick || null : null;
        }

        const baseName = origNick || loa.display_name;
        const newNick = formatLoaNickname(baseName);

        const modRes = await modifyGuildMemberNickname({
          env,
          guildId: loa.guild_id,
          userId: loa.user_id,
          newNickname: newNick,
          reason: "Staff LOA started",
          customFetch,
        });

        this.updateLoaNicknameState(loa.id, {
          originalNickname: origNick,
          loaNickname: newNick,
          nicknameModified: modRes.success ? 1 : 0,
        });

        if (modRes.success) {
          modifiedCount++;
        }
      } catch (err) {
        console.warn(`Error activating nickname for LOA ${loa.id}:`, err?.message || err);
      }
    }

    // 2. Restore roles for LOAs that completed or ended
    const toRestoreRoles = this.getLoasNeedingRoleRestoration(todayIso);
    for (const loa of toRestoreRoles) {
      try {
        const restoreRes = await executeLoaRoleRestore({
          env,
          guildId: loa.guild_id,
          userId: loa.user_id,
          loaRecord: loa,
          stub: this,
          customFetch,
        });

        await logLoaEnded({
          env,
          guildId: loa.guild_id,
          userId: loa.user_id,
          displayName: loa.display_name,
          reasonText: "completed scheduled LOA duration",
          restoredRoleIds: restoreRes.restoredRoleIds || [],
          failedRestoreRoleIds: restoreRes.failedRestoreRoleIds || [],
          isLegacy: restoreRes.isLegacy,
          customFetch,
        }).catch(() => {});

        modifiedCount++;
      } catch (err) {
        console.warn(`Error restoring roles for LOA ${loa.id}:`, err?.message || err);
      }
    }

    // 3. Restore nicknames for LOAs that completed or ended
    const toRestore = this.getLoasNeedingNicknameRestoration(todayIso);
    for (const loa of toRestore) {
      try {
        const memberRes = await getGuildMember({
          env,
          guildId: loa.guild_id,
          userId: loa.user_id,
          customFetch,
        });

        const currentNick = memberRes.success ? memberRes.member?.nick || null : null;
        const restoredNick = computeRestoredNickname({
          currentNickname: currentNick,
          originalNickname: loa.original_nickname,
          loaNickname: loa.loa_nickname,
        });

        const modRes = await modifyGuildMemberNickname({
          env,
          guildId: loa.guild_id,
          userId: loa.user_id,
          newNickname: restoredNick,
          reason: "Staff LOA completed/ended",
          customFetch,
        });

        this.updateLoaNicknameState(loa.id, {
          nicknameModified: 0,
        });

        this.notifySubscribers({
          loa,
          reasonText: "returned from LOA",
          env,
          customFetch,
        });

        if (modRes.success) {
          modifiedCount++;
        }
      } catch (err) {
        console.warn(`Error restoring nickname for LOA ${loa.id}:`, err?.message || err);
      }
    }

    // 4. If any changes occurred, refresh the public LOA list control panel
    if (modifiedCount > 0 && toActivate.length + toRestore.length + toRestoreRoles.length > 0) {
      try {
        const firstGuildId = (toActivate[0] || toRestore[0])?.guild_id;
        if (firstGuildId) {
          await refreshPublicLoaList({
            env,
            guildId: firstGuildId,
            todayIso,
            customFetch,
            repost: toActivate.length > 0,
          });
        }
      } catch (err) {
        console.warn("Failed to refresh public list during cron rollover:", err?.message || err);
      }
    }

    // 4. If LOA channel was changed and dashboard hasn't been posted to the new channel yet, post it
    const targetChannelId = env?.LOA_CHANNEL_ID || DEFAULT_LOA_CHANNEL_ID;
    const lastListChannelId = this.getMeta("last_list_channel_id");
    if (targetChannelId && lastListChannelId !== targetChannelId) {
      const activeOrUpcoming = this.getActiveLoasList(todayIso);
      const guildId =
        (activeOrUpcoming[0]?.guild_id) ||
        env?.DISCORD_GUILD_ID ||
        env?.GUILD_ID ||
        this.ctx?.id?.toString();
      if (guildId) {
        try {
          await refreshPublicLoaList({
            env,
            guildId,
            todayIso,
            customFetch,
            repost: true,
          });
        } catch (err) {
          console.warn("Failed to auto-refresh public list on channel change:", err?.message || err);
        }
      }
    }

    return {
      success: true,
      activatedCount: toActivate.length,
      restoredCount: toRestore.length,
      modifiedCount,
    };
  }

  /**
   * Retrieve metadata value by key.
   * @param {string} key
   * @returns {string|null}
   */
  getMeta(key) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT value FROM loa_metadata WHERE key = ?",
        key
      );
      const rows = [...cursor];
      return rows.length > 0 ? rows[0].value : null;
    }
    return this.memoryMeta.get(key) || null;
  }

  /**
   * Set metadata key/value pair.
   * @param {string} key
   * @param {string} value
   */
  setMeta(key, value) {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `INSERT INTO loa_metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        key,
        value
      );
    } else {
      this.memoryMeta.set(key, value);
    }
  }

  /**
   * Internal HTTP API handler for Worker <-> DO communication.
   *
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request, init) {
    if (typeof request === "string" || !(request instanceof Request)) {
      request = new Request(request, init);
    }
    const url = new URL(request.url);

    // 1. /loa/current (GET) -> find active or upcoming LOA for user
    if (request.method === "GET" && url.pathname === "/loa/current") {
      const userId = url.searchParams.get("userId");
      const todayIso = url.searchParams.get("today");
      if (!userId || !todayIso) {
        return new Response("Missing userId or today parameter", { status: 400 });
      }
      const loa = this.getActiveOrUpcomingLoa(userId, todayIso);
      return new Response(JSON.stringify({ loa }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. /loa/start (POST) -> create new LOA
    if (request.method === "POST" && url.pathname === "/loa/start") {
      const body = await request.json();
      const result = this.createLoa(body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. /loa/edit (POST) -> edit existing LOA
    if (request.method === "POST" && url.pathname === "/loa/edit") {
      const body = await request.json();
      const result = this.updateLoa(body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. /loa/cancel (POST) -> cancel upcoming LOA
    if (request.method === "POST" && url.pathname === "/loa/cancel") {
      const body = await request.json();
      const result = this.cancelLoa(body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 5. /loa/end-early (POST) -> end active LOA early
    if (request.method === "POST" && url.pathname === "/loa/end-early") {
      const body = await request.json();
      const result = this.endLoaEarly(body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 6. /loa/list (GET) -> retrieve active LOAs
    if (request.method === "GET" && url.pathname === "/loa/list") {
      const todayIso = url.searchParams.get("today");
      if (!todayIso) {
        return new Response("Missing today parameter", { status: 400 });
      }
      const loas = this.getActiveLoasList(todayIso);
      return new Response(JSON.stringify({ loas }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 7. /loa/meta (GET) -> retrieve metadata like lastListMessageId, lastListChannelId, and recentActivity
    if (request.method === "GET" && url.pathname === "/loa/meta") {
      const lastListMessageId = this.getMeta("last_list_message_id");
      const lastListChannelId = this.getMeta("last_list_channel_id");
      const recentActivity = this.getMeta("recent_activity");
      return new Response(
        JSON.stringify({ lastListMessageId, lastListChannelId, recentActivity }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 8. /loa/meta (POST) -> update metadata
    if (request.method === "POST" && url.pathname === "/loa/meta") {
      const body = await request.json();
      if (body.lastListMessageId !== undefined) {
        this.setMeta("last_list_message_id", body.lastListMessageId || "");
      }
      if (body.lastListChannelId !== undefined) {
        this.setMeta("last_list_channel_id", body.lastListChannelId || "");
      }
      if (body.recentActivity !== undefined) {
        this.setMeta("recent_activity", body.recentActivity || "");
      }
      const lastListMessageId = this.getMeta("last_list_message_id");
      const lastListChannelId = this.getMeta("last_list_channel_id");
      const recentActivity = this.getMeta("recent_activity");
      return new Response(
        JSON.stringify({ success: true, lastListMessageId, lastListChannelId, recentActivity }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 9. /loa/nickname-state (POST) -> update nickname fields for an LOA record
    if (request.method === "POST" && url.pathname === "/loa/nickname-state") {
      const body = await request.json();
      const result = this.updateLoaNicknameState(body.loaId, body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 10. /loa/cron (POST) -> date rollover nickname processing
    if (request.method === "POST" && url.pathname === "/loa/cron") {
      const body = (await request.json().catch(() => ({}))) || {};
      const todayIso = body.todayIso || getTodayInChicago();
      const result = await this.processCronRollover({
        env: this.env,
        todayIso,
      });
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 11. /loa/alerts/toggle (POST) -> toggle Return Alert subscription
    if (request.method === "POST" && url.pathname === "/loa/alerts/toggle") {
      const body = await request.json();
      const result = this.toggleSubscription(body);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 12. /loa/alerts/user (GET) -> get user subscriptions
    if (request.method === "GET" && url.pathname === "/loa/alerts/user") {
      const userId = url.searchParams.get("userId") || "";
      const subscriptions = this.getUserSubscriptions(userId);
      return new Response(JSON.stringify({ subscriptions }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 13. /loa/role-snapshot (POST) -> update role snapshot fields
    if (request.method === "POST" && url.pathname === "/loa/role-snapshot") {
      const body = await request.json();
      const result = this.updateLoaRoleSnapshot(body.loaId, body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 14. /loa/role-restore (POST) -> update role restore fields
    if (request.method === "POST" && url.pathname === "/loa/role-restore") {
      const body = await request.json();
      const result = this.updateLoaRoleRestoration(body.loaId, body);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 15. /loa/history (GET) -> retrieve user's complete LOA history
    if (request.method === "GET" && url.pathname === "/loa/history") {
      const userId = url.searchParams.get("userId") || "";
      const history = this.getLoaHistoryForUser(userId);
      return new Response(JSON.stringify({ history }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 16. /loa/history-all (GET) -> retrieve recent server LOAs
    if (request.method === "GET" && url.pathname === "/loa/history-all") {
      const limit = parseInt(url.searchParams.get("limit") || "25", 10);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);
      const history = this.getAllLoasHistory({ limit, offset });
      return new Response(JSON.stringify({ history }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  /**
   * Toggle a return alert subscription for a user on an LOA.
   * @param {Object} params
   * @param {string} params.loaId
   * @param {string} params.userId
   * @param {string} params.guildId
   * @param {string} [params.createdAt]
   * @returns {{ success: boolean, subscribed: boolean }}
   */
  toggleSubscription({ loaId, userId, guildId, createdAt = new Date().toISOString() }) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT 1 FROM loa_subscriptions WHERE loa_id = ? AND subscriber_user_id = ?",
        loaId,
        userId
      );
      const exists = [...cursor].length > 0;
      if (exists) {
        this.ctx.storage.sql.exec(
          "DELETE FROM loa_subscriptions WHERE loa_id = ? AND subscriber_user_id = ?",
          loaId,
          userId
        );
        return { success: true, subscribed: false };
      } else {
        this.ctx.storage.sql.exec(
          "INSERT INTO loa_subscriptions (loa_id, subscriber_user_id, guild_id, created_at) VALUES (?, ?, ?, ?)",
          loaId,
          userId,
          guildId,
          createdAt
        );
        return { success: true, subscribed: true };
      }
    }

    const key = `${loaId}:${userId}`;
    if (this.memorySubscriptions.has(key)) {
      this.memorySubscriptions.delete(key);
      return { success: true, subscribed: false };
    } else {
      this.memorySubscriptions.set(key, { loaId, userId, guildId, createdAt });
      return { success: true, subscribed: true };
    }
  }

  /**
   * Get all subscribers for a specific LOA.
   * @param {string} loaId
   * @returns {Array<string>}
   */
  getSubscribersForLoa(loaId) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT subscriber_user_id FROM loa_subscriptions WHERE loa_id = ?",
        loaId
      );
      return [...cursor].map((r) => r.subscriber_user_id);
    }
    const subs = [];
    for (const record of this.memorySubscriptions.values()) {
      if (record.loaId === loaId) {
        subs.push(record.userId);
      }
    }
    return subs;
  }

  /**
   * Clear all subscribers for an LOA after alert notification.
   * @param {string} loaId
   */
  clearSubscriptionsForLoa(loaId) {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        "DELETE FROM loa_subscriptions WHERE loa_id = ?",
        loaId
      );
    } else {
      for (const [key, record] of this.memorySubscriptions.entries()) {
        if (record.loaId === loaId) {
          this.memorySubscriptions.delete(key);
        }
      }
    }
  }

  /**
   * Get all LOA IDs a user is subscribed to.
   * @param {string} userId
   * @returns {Array<string>}
   */
  getUserSubscriptions(userId) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT loa_id FROM loa_subscriptions WHERE subscriber_user_id = ?",
        userId
      );
      return [...cursor].map((r) => r.loa_id);
    }
    const subs = [];
    for (const record of this.memorySubscriptions.values()) {
      if (record.userId === userId) {
        subs.push(record.loaId);
      }
    }
    return subs;
  }

  /**
   * Dispatch notification to subscribers when an LOA returns or cancels.
   * @param {Object} options
   */
  async notifySubscribers({
    loa,
    reasonText = "returned from LOA",
    env = this.env,
    customFetch = fetch,
  }) {
    if (!loa || !loa.id) return;
    const subscribers = this.getSubscribersForLoa(loa.id);
    if (!subscribers || subscribers.length === 0) return;

    this.clearSubscriptionsForLoa(loa.id);

    const botToken = env?.DISCORD_BOT_TOKEN;
    const channelId = env?.LOA_CHANNEL_ID || DEFAULT_LOA_CHANNEL_ID;
    if (botToken && channelId) {
      try {
        const cleanName = stripLoaPrefix(loa.display_name) || "Staff member";
        const mentions = subscribers.map((id) => `<@${id}>`).join(" ");
        const content = `🔔 **Return Alert:** ${mentions} — **${cleanName}** has ${reasonText}!`;
        await customFetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content,
            allowed_mentions: {
              parse: [],
              users: subscribers,
            },
          }),
        });
      } catch (err) {
        console.warn("Failed to dispatch return alerts:", err?.message || err);
      }
    }
  }
}
