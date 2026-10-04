/**
 * Dynamic Configuration & Audit Log Storage Service.
 * Manages persisting dashboard modifications to Cloudflare D1 with in-memory caching
 * and safe fallback for local/unit testing.
 */

const memoryConfigCache = new Map();
const memoryAuditLogs = [];

/**
 * Ensure database tables exist in D1.
 *
 * @param {Object} db Cloudflare D1 binding
 */
async function ensureTables(db) {
  if (!db) return;
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS bot_dynamic_configs (
        module_id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bot_config_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        module_id TEXT NOT NULL,
        module_name TEXT NOT NULL,
        action TEXT NOT NULL,
        key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT
      );
    `);
  } catch (err) {
    console.warn("[DynamicConfigDb] Warning ensuring D1 tables:", err?.message || err);
  }
}

/**
 * Get dynamic configuration for a module from D1 (with memory fallback).
 *
 * @param {Object} env Cloudflare Worker environment
 * @param {string} moduleId Module identifier (e.g. 'refunds')
 * @returns {Promise<Object|null>}
 */
export async function getDynamicModuleConfig(env, moduleId) {
  if (memoryConfigCache.has(moduleId)) {
    return memoryConfigCache.get(moduleId);
  }

  const db = env?.REFUND_DB || env?.PUNISHMENT_DB;
  if (!db) {
    return null;
  }

  try {
    await ensureTables(db);
    const row = await db
      .prepare("SELECT config_json FROM bot_dynamic_configs WHERE module_id = ?")
      .bind(moduleId)
      .first();

    if (row?.config_json) {
      const parsed = JSON.parse(row.config_json);
      memoryConfigCache.set(moduleId, parsed);
      return parsed;
    }
  } catch (err) {
    console.warn(`[DynamicConfigDb] Failed to read dynamic config for ${moduleId}:`, err?.message || err);
  }

  return null;
}

/**
 * Save dynamic configuration for a module to D1.
 *
 * @param {Object} env Cloudflare Worker environment
 * @param {string} moduleId Module identifier (e.g. 'refunds')
 * @param {Object} config The configuration object to store
 * @param {Object} user Admin who made the change
 * @returns {Promise<boolean>}
 */
export async function saveDynamicModuleConfig(env, moduleId, config, user = { id: "admin", name: "Administrator" }) {
  memoryConfigCache.set(moduleId, config);

  const db = env?.REFUND_DB || env?.PUNISHMENT_DB;
  if (!db) {
    return true; // Memory cache updated
  }

  try {
    await ensureTables(db);
    const now = new Date().toISOString();
    const jsonStr = JSON.stringify(config);

    await db
      .prepare(`
        INSERT INTO bot_dynamic_configs (module_id, config_json, updated_at, updated_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(module_id) DO UPDATE SET
          config_json = excluded.config_json,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `)
      .bind(moduleId, jsonStr, now, user.name || user.id)
      .run();

    return true;
  } catch (err) {
    console.error(`[DynamicConfigDb] Failed to save dynamic config for ${moduleId}:`, err?.message || err);
    return false;
  }
}

/**
 * Record an entry into the configuration audit log.
 *
 * @param {Object} env Cloudflare Worker environment
 * @param {Object} entry Audit record
 */
export async function recordConfigAudit(env, entry) {
  const record = {
    id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };

  memoryAuditLogs.unshift(record);
  if (memoryAuditLogs.length > 50) memoryAuditLogs.pop();

  const db = env?.REFUND_DB || env?.PUNISHMENT_DB;
  if (!db) return;

  try {
    await ensureTables(db);
    await db
      .prepare(`
        INSERT INTO bot_config_audits (timestamp, user_id, user_name, module_id, module_name, action, key, old_value, new_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        record.timestamp,
        record.userId || "system",
        record.userName || "System",
        record.moduleId || "core",
        record.moduleName || record.moduleId || "Core",
        record.action || "update",
        record.key || "",
        typeof record.oldValue === "object" ? JSON.stringify(record.oldValue) : String(record.oldValue ?? ""),
        typeof record.newValue === "object" ? JSON.stringify(record.newValue) : String(record.newValue ?? "")
      )
      .run();
  } catch (err) {
    console.warn("[DynamicConfigDb] Failed to record audit log in D1:", err?.message || err);
  }
}

/**
 * Retrieve configuration audit logs from D1.
 *
 * @param {Object} env Cloudflare Worker environment
 * @param {number} [limit=50]
 * @returns {Promise<Array<Object>>}
 */
export async function getRecentConfigAudits(env, limit = 50) {
  const db = env?.REFUND_DB || env?.PUNISHMENT_DB;
  if (!db) {
    return memoryAuditLogs;
  }

  try {
    await ensureTables(db);
    const { results } = await db
      .prepare(`
        SELECT id, timestamp, user_id as userId, user_name as userName, module_id as moduleId,
               module_name as moduleName, action, key, old_value as oldValue, new_value as newValue
        FROM bot_config_audits
        ORDER BY id DESC
        LIMIT ?
      `)
      .bind(limit)
      .all();

    if (results && results.length > 0) {
      return results;
    }
  } catch (err) {
    console.warn("[DynamicConfigDb] Failed to fetch audit logs from D1:", err?.message || err);
  }

  return memoryAuditLogs;
}
