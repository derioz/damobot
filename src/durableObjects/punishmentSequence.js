/**
 * Format a numeric integer sequence into the standardized human-readable Punishment ID.
 * Example: 1 -> "VRP-P-000001", 142 -> "VRP-P-000142"
 *
 * @param {number|string} seq
 * @returns {string}
 */
export function formatPunishmentId(seq) {
  const num = parseInt(seq, 10) || 0;
  return `VRP-P-${String(num).padStart(6, "0")}`;
}

/**
 * Format a numeric integer sequence into the standardized human-readable Refund ID.
 * Example: 1 -> "VRP-R-000001", 42 -> "VRP-R-000042"
 *
 * @param {number|string} seq
 * @returns {string}
 */
export function formatRefundId(seq) {
  const num = parseInt(seq, 10) || 0;
  return `VRP-R-${String(num).padStart(6, "0")}`;
}

/**
 * Extract numeric portion from a Punishment ID or raw query string.
 * Returns null if no numeric sequence is found.
 * Examples: "VRP-P-000142" -> 142, "000142" -> 142, "142" -> 142
 *
 * @param {string} input
 * @returns {number|null}
 */
export function extractNumericSequence(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  const match = trimmed.match(/^(?:VRP-P-)?0*([1-9]\d*)$/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  // Check if all digits
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  return null;
}

/**
 * Extract numeric portion from a Refund ID or raw query string.
 * Returns null if no numeric sequence is found.
 * Examples: "VRP-R-000001" -> 1, "000001" -> 1, "1" -> 1
 *
 * @param {string} input
 * @returns {number|null}
 */
export function extractRefundNumericSequence(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  const match = trimmed.match(/^(?:VRP-R-)?0*([1-9]\d*)$/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  // Check if all digits
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }
  return null;
}

/**
 * Durable Object for atomic, concurrency-safe Punishment ID sequence allocation.
 *
 * IMPORTANT ARCHITECTURE NOTE:
 * This Durable Object stores ONLY the integer counter sequence and permanent center message ID.
 * ALL actual punishment records, player details, and audit history live in Google Sheets.
 * This remains 100% compatible with Cloudflare Workers Free plan limits.
 */
export class PunishmentSequenceDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    // Memory fallback for mock/test environments where SQLite is not attached
    this.memorySequence = 1;
    this.memoryRefundSequence = 1;
    this.memoryMeta = new Map();
    this.memoryPending = new Map();

    this.initDatabase();
  }

  /**
   * Initialize SQLite tables.
   */
  initDatabase() {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS sequence (
          id INTEGER PRIMARY KEY,
          next_val INTEGER NOT NULL
        );
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS pending_replacements (
          token TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      this.ctx.storage.sql.exec(`
        INSERT OR IGNORE INTO sequence (id, next_val) VALUES (1, 1);
      `);
      this.ctx.storage.sql.exec(`
        INSERT OR IGNORE INTO sequence (id, next_val) VALUES (2, 1);
      `);
    }
  }

  /**
   * Atomically allocate the next unique sequential Punishment ID.
   * Concurrency-safe: simultaneous callers receive guaranteed distinct sequential values.
   *
   * @returns {{ sequence: number, punishmentId: string }}
   */
  allocateNextId() {
    if (this.ctx?.storage?.sql) {
      // Execute atomically
      const cursor = this.ctx.storage.sql.exec(
        "SELECT next_val FROM sequence WHERE id = 1"
      );
      const rows = [...cursor];
      const currentVal = rows.length > 0 ? rows[0].next_val : 1;
      const nextVal = currentVal + 1;

      this.ctx.storage.sql.exec(
        "UPDATE sequence SET next_val = ? WHERE id = 1",
        nextVal
      );

      return {
        sequence: currentVal,
        punishmentId: formatPunishmentId(currentVal),
      };
    }

    const currentVal = this.memorySequence;
    this.memorySequence = currentVal + 1;
    return {
      sequence: currentVal,
      punishmentId: formatPunishmentId(currentVal),
    };
  }

  /**
   * Atomically allocate the next unique sequential Refund ID.
   * Concurrency-safe: simultaneous callers receive guaranteed distinct sequential values.
   * Example: 1 -> "VRP-R-000001"
   *
   * @returns {{ sequence: number, refundId: string }}
   */
  allocateNextRefundId() {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT next_val FROM sequence WHERE id = 2"
      );
      const rows = [...cursor];
      const currentVal = rows.length > 0 ? rows[0].next_val : 1;
      const nextVal = currentVal + 1;

      this.ctx.storage.sql.exec(
        "UPDATE sequence SET next_val = ? WHERE id = 2",
        nextVal
      );

      return {
        sequence: currentVal,
        refundId: formatRefundId(currentVal),
      };
    }

    const currentVal = this.memoryRefundSequence;
    this.memoryRefundSequence = currentVal + 1;
    return {
      sequence: currentVal,
      refundId: formatRefundId(currentVal),
    };
  }

  /**
   * Get current next refund sequence without allocating.
   * @returns {number}
   */
  getCurrentRefundSequence() {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT next_val FROM sequence WHERE id = 2"
      );
      const rows = [...cursor];
      return rows.length > 0 ? rows[0].next_val : 1;
    }
    return this.memoryRefundSequence;
  }

  /**
   * Ensure refund sequence is at least a specified minimum.
   * @param {number} minNextVal
   */
  syncRefundSequence(minNextVal) {
    const val = parseInt(minNextVal, 10);
    if (!isNaN(val) && val > 0) {
      if (this.ctx?.storage?.sql) {
        this.ctx.storage.sql.exec(
          "UPDATE sequence SET next_val = MAX(next_val, ?) WHERE id = 2",
          val
        );
      } else {
        this.memoryRefundSequence = Math.max(this.memoryRefundSequence, val);
      }
    }
  }

  /**
   * Get current next sequence without allocating.
   * @returns {number}
   */
  getCurrentSequence() {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT next_val FROM sequence WHERE id = 1"
      );
      const rows = [...cursor];
      return rows.length > 0 ? rows[0].next_val : 1;
    }
    return this.memorySequence;
  }

  /**
   * Ensure sequence is at least a specified minimum (useful when syncing with existing sheet records).
   * @param {number} minNextVal
   */
  syncSequence(minNextVal) {
    const val = parseInt(minNextVal, 10);
    if (!isNaN(val) && val > 0) {
      if (this.ctx?.storage?.sql) {
        this.ctx.storage.sql.exec(
          "UPDATE sequence SET next_val = MAX(next_val, ?) WHERE id = 1",
          val
        );
      } else {
        this.memorySequence = Math.max(this.memorySequence, val);
      }
    }
  }

  /**
   * Get metadata value (e.g. permanent center message ID).
   * @param {string} key
   * @returns {string|null}
   */
  getMeta(key) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT value FROM meta WHERE key = ?",
        key
      );
      const rows = [...cursor];
      return rows.length > 0 ? rows[0].value : null;
    }
    return this.memoryMeta.get(key) || null;
  }

  /**
   * Set metadata value.
   * @param {string} key
   * @param {string} value
   */
  setMeta(key, value) {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key,
        value
      );
    } else {
      this.memoryMeta.set(key, value);
    }
  }

  /**
   * Save a temporary pending action/confirmation state.
   * Auto-purges expired entries.
   *
   * @param {string} token
   * @param {Object} dataObj
   * @param {number} [ttlMs=600000] 10 minutes default
   * @returns {{ ok: boolean, expiresAt: number }}
   */
  savePendingReplacement(token, dataObj, ttlMs = 10 * 60 * 1000) {
    const expiresAt = Date.now() + ttlMs;
    const json = JSON.stringify(dataObj);

    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_replacements WHERE expires_at < ?",
        Date.now()
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO pending_replacements (token, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at",
        token,
        json,
        expiresAt
      );
    } else {
      this.memoryPending.set(token, { json, expiresAt });
    }
    return { ok: true, expiresAt };
  }

  /**
   * Look up pending replacement state if not expired.
   *
   * @param {string} token
   * @returns {Object|null}
   */
  getPendingReplacement(token) {
    const now = Date.now();
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT data, expires_at FROM pending_replacements WHERE token = ?",
        token
      );
      const rows = [...cursor];
      if (rows.length === 0) return null;
      if (rows[0].expires_at < now) {
        this.ctx.storage.sql.exec("DELETE FROM pending_replacements WHERE token = ?", token);
        return null;
      }
      try {
        return JSON.parse(rows[0].data);
      } catch {
        return null;
      }
    }

    const item = this.memoryPending.get(token);
    if (!item) return null;
    if (item.expiresAt < now) {
      this.memoryPending.delete(token);
      return null;
    }
    try {
      return JSON.parse(item.json);
    } catch {
      return null;
    }
  }

  /**
   * Atomically retrieve and consume/delete pending replacement state.
   *
   * @param {string} token
   * @returns {Object|null}
   */
  consumePendingReplacement(token) {
    const record = this.getPendingReplacement(token);
    if (record) {
      if (this.ctx?.storage?.sql) {
        this.ctx.storage.sql.exec("DELETE FROM pending_replacements WHERE token = ?", token);
      } else {
        this.memoryPending.delete(token);
      }
    }
    return record;
  }

  /**
   * Handle HTTP requests to the Durable Object stub.
   */
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/sequence/next") {
      const result = this.allocateNextId();
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/sequence/current") {
      const seq = this.getCurrentSequence();
      return new Response(JSON.stringify({ nextSequence: seq }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/sequence/sync") {
      const body = await request.json().catch(() => ({}));
      this.syncSequence(body.minNextVal);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/sequence/refund/next") {
      const result = this.allocateNextRefundId();
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/sequence/refund/current") {
      const seq = this.getCurrentRefundSequence();
      return new Response(JSON.stringify({ nextSequence: seq }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/sequence/refund/sync") {
      const body = await request.json().catch(() => ({}));
      this.syncRefundSequence(body.minNextVal);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/meta/center") {
      const messageId = this.getMeta("center_message_id");
      return new Response(JSON.stringify({ messageId }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/meta/center") {
      const body = await request.json().catch(() => ({}));
      if (body.messageId) {
        this.setMeta("center_message_id", String(body.messageId));
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/pending-replacement/save") {
      const body = await request.json().catch(() => ({}));
      const result = this.savePendingReplacement(body.token, body.data, body.ttlMs);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/pending-replacement/get") {
      const token = url.searchParams.get("token") || "";
      const data = this.getPendingReplacement(token);
      return new Response(JSON.stringify({ found: !!data, data }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/pending-replacement/consume") {
      const body = await request.json().catch(() => ({}));
      const data = this.consumePendingReplacement(body.token || "");
      return new Response(JSON.stringify({ found: !!data, data }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }
}
