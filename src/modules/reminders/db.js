/**
 * Ticket Reminder D1 Database Access Layer.
 */

import { createRequire } from "node:module";
import { ReminderStatus, ReminderType } from "./constants.js";

/**
 * Resolve the D1 Database binding from environment.
 *
 * @param {Object} env
 * @returns {D1Database}
 */
export function getDatabase(env) {
  const db = env?.PUNISHMENT_DB || env?.DB || env?.damo_bot_punishments;
  if (!db) {
    throw new Error(
      "Missing D1 database binding in environment configuration (expected PUNISHMENT_DB or DB)."
    );
  }
  return db;
}

let reminderCounter = 0;

/**
 * Generate a unique, compact, human-readable reminder ID.
 * Example: REM-M6TA1-4K9F
 *
 * @returns {string}
 */
export function generateReminderId() {
  reminderCounter = (reminderCounter + 1) % 10000;
  const timePart = Date.now().toString(36).toUpperCase();
  const randPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `REM-${timePart}-${randPart}`;
}

/**
 * Insert a new ticket reminder into Cloudflare D1.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {Object} options.reminder
 * @returns {Promise<Object>}
 */
export async function createReminder({ env, reminder }) {
  const db = getDatabase(env);
  const id = reminder.id || generateReminderId();
  const guildId = String(reminder.guild_id || reminder.guildId || "").trim();
  const threadId = String(reminder.thread_id || reminder.threadId || "").trim();
  const threadName = String(reminder.thread_name || reminder.threadName || "").trim();
  const parentChannelId = String(reminder.parent_channel_id || reminder.parentChannelId || "").trim();
  const createdByUserId = String(reminder.created_by_user_id || reminder.createdByUserId || "").trim();
  const reminderType = reminder.reminder_type || reminder.reminderType || ReminderType.PERSONAL;
  const reminderMessage = String(reminder.reminder_message || reminder.reminderMessage || "").trim();
  const createdAt = reminder.created_at || reminder.createdAt || new Date().toISOString();
  const remindAt = reminder.remind_at || reminder.remindAt || new Date().toISOString();
  const status = reminder.status || ReminderStatus.PENDING;

  const sql = `
    INSERT INTO ticket_reminders (
      id, guild_id, thread_id, thread_name, parent_channel_id,
      created_by_user_id, reminder_type, reminder_message,
      created_at, remind_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await db
    .prepare(sql)
    .bind(
      id,
      guildId,
      threadId,
      threadName,
      parentChannelId,
      createdByUserId,
      reminderType,
      reminderMessage,
      createdAt,
      remindAt,
      status
    )
    .run();

  return {
    id,
    guildId,
    threadId,
    threadName,
    parentChannelId,
    createdByUserId,
    reminderType,
    reminderMessage,
    createdAt,
    remindAt,
    status,
  };
}

/**
 * Fetch all due reminders that are pending (indexed query on status + remind_at).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} [options.nowIso] Current ISO timestamp in UTC
 * @param {number} [options.limit=50] Maximum number of reminders to fetch per cron batch
 * @returns {Promise<Array<Object>>}
 */
export async function getDueReminders({ env, nowIso, limit = 50 }) {
  const db = getDatabase(env);
  const now = nowIso || new Date().toISOString();
  const safeLimit = Math.max(1, parseInt(limit, 10) || 50);

  const sql = `
    SELECT * FROM ticket_reminders
    WHERE status = ? AND remind_at <= ?
    ORDER BY remind_at ASC
    LIMIT ?
  `;

  const { results } = await db
    .prepare(sql)
    .bind(ReminderStatus.PENDING, now, safeLimit)
    .all();

  return results || [];
}

/**
 * Atomically claim a pending reminder for processing by setting status to 'sending'.
 * Prevents race conditions and duplicate sends across concurrent cron triggers.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.id
 * @returns {Promise<boolean>} True if successfully claimed, false if already claimed/sent
 */
export async function claimReminder({ env, id }) {
  const db = getDatabase(env);
  const sql = `
    UPDATE ticket_reminders
    SET status = ?
    WHERE id = ? AND status = ?
  `;

  const res = await db
    .prepare(sql)
    .bind(ReminderStatus.SENDING, id, ReminderStatus.PENDING)
    .run();

  const changes = res?.meta?.changes ?? (res?.success ? 1 : 0);
  return changes > 0;
}

/**
 * Mark a reminder as successfully sent with a timestamp.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.id
 * @param {string} [options.sentAtIso]
 * @returns {Promise<boolean>}
 */
export async function markReminderSent({ env, id, sentAtIso }) {
  const db = getDatabase(env);
  const sentAt = sentAtIso || new Date().toISOString();

  const sql = `
    UPDATE ticket_reminders
    SET status = ?, sent_at = ?
    WHERE id = ?
  `;

  await db.prepare(sql).bind(ReminderStatus.SENT, sentAt, id).run();
  return true;
}

/**
 * Revert a reminder from 'sending' back to 'pending' if Discord delivery fails.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.id
 * @returns {Promise<boolean>}
 */
export async function revertReminderPending({ env, id }) {
  const db = getDatabase(env);
  const sql = `
    UPDATE ticket_reminders
    SET status = ?
    WHERE id = ? AND status = ?
  `;

  await db
    .prepare(sql)
    .bind(ReminderStatus.PENDING, id, ReminderStatus.SENDING)
    .run();

  return true;
}

/**
 * Cancel a pending reminder.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.id
 * @returns {Promise<boolean>}
 */
export async function cancelReminder({ env, id }) {
  const db = getDatabase(env);
  const sql = `
    UPDATE ticket_reminders
    SET status = ?
    WHERE id = ? AND status = ?
  `;

  const res = await db
    .prepare(sql)
    .bind(ReminderStatus.CANCELLED, id, ReminderStatus.PENDING)
    .run();

  const changes = res?.meta?.changes ?? (res?.success ? 1 : 0);
  return changes > 0;
}

/**
 * Get a single reminder by ID.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.id
 * @returns {Promise<Object|null>}
 */
export async function getReminderById({ env, id }) {
  const db = getDatabase(env);
  const sql = `SELECT * FROM ticket_reminders WHERE id = ? LIMIT 1`;
  const row = await db.prepare(sql).bind(id).first();
  return row || null;
}

/**
 * Get all active pending reminders created by a specific user.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.userId
 * @param {number} [options.limit=10]
 * @returns {Promise<Array<Object>>}
 */
export async function getPendingRemindersByUser({ env, userId, limit = 10 }) {
  const db = getDatabase(env);
  const sql = `
    SELECT * FROM ticket_reminders
    WHERE created_by_user_id = ? AND status = ?
    ORDER BY remind_at ASC
    LIMIT ?
  `;

  const { results } = await db
    .prepare(sql)
    .bind(userId, ReminderStatus.PENDING, limit)
    .all();

  return results || [];
}

/**
 * Get all active pending reminders in a specific ticket thread.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.threadId
 * @returns {Promise<Array<Object>>}
 */
export async function getPendingRemindersByThread({ env, threadId }) {
  const db = getDatabase(env);
  const sql = `
    SELECT * FROM ticket_reminders
    WHERE thread_id = ? AND status = ?
    ORDER BY remind_at ASC
  `;

  const { results } = await db
    .prepare(sql)
    .bind(threadId, ReminderStatus.PENDING)
    .all();

  return results || [];
}

/**
 * In-memory D1-compatible mock database for Node.js unit testing.
 *
 * @returns {Object}
 */
export function createMockRemindersDatabase() {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(":memory:");

  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_reminders (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      thread_name TEXT NOT NULL DEFAULT '',
      parent_channel_id TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT NOT NULL,
      reminder_type TEXT NOT NULL DEFAULT 'personal',
      reminder_message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_status_remind_at ON ticket_reminders(status, remind_at);
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_thread_id ON ticket_reminders(thread_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_reminders_created_by ON ticket_reminders(created_by_user_id);
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
    async exec(sql) {
      db.exec(sql);
      return { success: true };
    },
    rawDb: db,
  };
}
