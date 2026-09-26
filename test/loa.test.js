import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker, { StaffLoaDO } from "../src/index.js";
import {
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import {
  parseAndValidateDate,
  isoToDisplayDate,
  formatPrettyDate,
  formatPrettyDateRange,
  formatCompactDateRange,
  getTodayInChicago,
  getLoaStatus,
  isLeapYear,
  getDaysInMonth,
} from "../src/loa/dateUtils.js";
import {
  IS_COMPONENTS_V2_FLAG,
  EPHEMERAL_FLAG,
  VITAL_ORANGE,
  ComponentType,
  LoaCustomId,
  buildLoaListContainers,
  createLoaControlActionRows,
  refreshPublicLoaList,
  buildDamoFooter,
  createSection,
  createThumbnail,
} from "../src/loa/loaHandler.js";
import {
  DAMO_BOT_VERSION,
  VITAL_RP_LOGO_URL,
  DEFAULT_OWNER_ROLE_ID,
} from "../src/config.js";
import { bumpVersionString } from "../scripts/bump-version.js";
import { commands } from "../scripts/register-commands.js";
import {
  NICKNAME_PREFIX,
  MAX_NICKNAME_LENGTH,
  truncateGraphemes,
  hasLoaPrefix,
  stripLoaPrefix,
  formatLoaNickname,
  computeRestoredNickname,
} from "../src/loa/nicknameUtils.js";

import {
  executeLoaRoleSwap,
  executeLoaRoleRestore,
  calculateLoaRoleSwapDiff,
  validateRoleHierarchy,
  getGuildRoles,
  getBotGuildMember,
  getBotHighestRolePosition,
  DEFAULT_PRESERVED_ROLE_IDS,
  isProtectedStaffRole,
  determineLoaRoleToAssign,
} from "../src/loa/roleUtils.js";
import {
  handleLoaInfoCommand,
} from "../src/loa/loaHandler.js";
import {
  logLoaStarted,
  logLoaEnded,
  logLoaWarning,
  sendLoaLogMessage,
} from "../src/loa/loaLogger.js";
import {
  DEFAULT_STAFF_LOA_ROLE_ID,
  DEFAULT_VRP_MANAGEMENT_ROLE_ID,
  DEFAULT_ROLE_WHITELIST_APPROVED,
  DEFAULT_ROLE_KEYBOARD_WARRIOR,
  DEFAULT_ROLE_GIF,
  DEFAULT_ROLE_MEMBER,
  DEFAULT_HEAD_ADMIN_ROLE_ID,
  DEFAULT_SENIOR_ADMIN_ROLE_ID,
  DEFAULT_HEAD_OF_STAFF_ROLE_ID,
  DEFAULT_ADMIN_ROLE_ID,
  DEFAULT_MODERATOR_ROLE_ID,
  DEFAULT_SUPPORT_STAFF_ROLE_ID,
  DEFAULT_LOA_MODERATOR_ROLE_ID,
  DEFAULT_LOA_SUPPORT_ROLE_ID,
  DEFAULT_PROTECTED_LEADERSHIP_ROLE_IDS,
} from "../src/config/roles.js";
import {
  DEFAULT_LOA_LOG_CHANNEL_ID,
  DEFAULT_SUPPORT_CHAT_CHANNEL_ID,
  DEFAULT_MODERATOR_CHAT_CHANNEL_ID,
} from "../src/config/channels.js";
import { canViewLoaHistory, hasStaffLoaRole, getLoaConfig } from "../src/config.js";

const TEST_STAFF_ROLE_ID = "743422836223246366";
const TEST_LOA_CHANNEL_ID = "1546281163247722516";
const OTHER_CHANNEL_ID = "111222333444555666";

const nativeFetch = globalThis.fetch;
export function mockDiscordFetchFallback(url, options = {}) {
  const urlStr = String(url);
  if (urlStr.includes("/guilds/") && urlStr.includes("/roles")) {
    return new Response(
      JSON.stringify([
        { id: "bot_role_highest", name: "Bot Role", position: 999 },
        { id: TEST_STAFF_ROLE_ID, name: "StaffTeam", position: 10 },
        { id: "1546696583976980541", name: "LOA", position: 9 },
        { id: "1241050651677556806", name: "Whitelist Approved", position: 5 },
        { id: "1371677888964726818", name: "Keyboard Warrior", position: 4 },
        { id: "735479005561618452", name: "Gif", position: 3 },
        { id: "733384365513506856", name: "Member", position: 2 },
      ]),
      { status: 200 }
    );
  }
  if (urlStr.includes("/members/@me")) {
    return new Response(
      JSON.stringify({
        user: { id: "bot_user" },
        roles: ["bot_role_highest"],
      }),
      { status: 200 }
    );
  }
  if (
    urlStr.includes("/members/") &&
    (options.method === "PATCH" || options.method === "PUT" || options.method === "DELETE")
  ) {
    return new Response(JSON.stringify({ roles: [] }), { status: 200 });
  }
  if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
    return new Response(JSON.stringify({ id: `msg_mock_${Date.now()}` }), { status: 200 });
  }
  return new Response(JSON.stringify({}), { status: 200 });
}

// Wrap baseline globalThis.fetch to safely intercept Discord REST API calls in tests
globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url);
  if (urlStr.includes("discord.com")) {
    return mockDiscordFetchFallback(url, options);
  }
  return nativeFetch(url, options);
};

async function signDiscordPayload(body, keyPair, timestamp) {
  const message = Buffer.concat([
    Buffer.from(timestamp, "utf-8"),
    Buffer.from(body, "utf-8"),
  ]);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    message
  );
  return Buffer.from(signature).toString("hex");
}

function createMockLoaDO(env = {}) {
  let executedQueryCount = 0;

  const mockStorage = {
    records: new Map(),
    metadata: new Map(),
    subscriptions: new Map(),
    getQueryCount: () => executedQueryCount,
    sql: {
      exec(query, ...params) {
        const normalized = query.replace(/\s+/g, " ").trim();

        if (
          normalized.includes("CREATE TABLE") ||
          normalized.includes("CREATE INDEX") ||
          normalized.includes("ALTER TABLE")
        ) {
          return [];
        }

        executedQueryCount++;

        // Metadata queries
        if (normalized.includes("SELECT value FROM loa_metadata WHERE key = ?")) {
          const [key] = params;
          const val = mockStorage.metadata.get(key);
          return val !== undefined ? [{ value: val }] : [];
        }

        if (normalized.includes("INSERT INTO loa_metadata")) {
          const [key, val] = params;
          mockStorage.metadata.set(key, val);
          return [];
        }

        // Staff LOA queries
        if (normalized.includes("SELECT * FROM staff_loas WHERE user_id = ? ORDER BY created_at DESC")) {
          const [userId] = params;
          const matches = [];
          for (const rec of mockStorage.records.values()) {
            if (rec.user_id === userId) {
              matches.push({ ...rec });
            }
          }
          matches.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
          return matches;
        }

        if (normalized.includes("SELECT * FROM staff_loas ORDER BY created_at DESC")) {
          const [limit = 25, offset = 0] = params;
          const list = Array.from(mockStorage.records.values()).map((r) => ({ ...r }));
          list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
          return list.slice(offset, offset + limit);
        }

        if (
          normalized.includes("SELECT * FROM staff_loas") &&
          normalized.includes("role_swap_status = 'completed'")
        ) {
          const [todayIso] = params;
          const list = [];
          for (const rec of mockStorage.records.values()) {
            const isEnded =
              rec.end_date < todayIso ||
              rec.cancelled === 1 ||
              rec.ended_early === 1 ||
              Boolean(rec.ended_at);
            const needsRestore =
              !rec.role_restore_status ||
              rec.role_restore_status === "none" ||
              rec.role_restore_status === "pending";
            const swapDone = rec.role_swap_status === "completed";
            if (isEnded && needsRestore && swapDone) {
              list.push({ ...rec });
            }
          }
          list.sort((a, b) => (a.end_date || "").localeCompare(b.end_date || ""));
          return list;
        }

        if (normalized.includes("SELECT * FROM staff_loas WHERE user_id = ?")) {
          const [userId, todayIso] = params;
          const matches = [];
          for (const rec of mockStorage.records.values()) {
            if (
              rec.user_id === userId &&
              rec.cancelled === 0 &&
              rec.ended_early === 0 &&
              !rec.ended_at &&
              rec.end_date >= todayIso
            ) {
              matches.push({ ...rec });
            }
          }
          matches.sort((a, b) => a.start_date.localeCompare(b.start_date));
          return matches.slice(0, 1);
        }

        if (normalized.includes("SELECT * FROM staff_loas WHERE id = ?")) {
          const id = params[0];
          const rec = mockStorage.records.get(id);
          return rec ? [{ ...rec }] : [];
        }

        if (normalized.includes("INSERT INTO staff_loas")) {
          const [
            id,
            guild_id,
            user_id,
            display_name,
            start_date,
            end_date,
            reason,
            created_at,
            updated_at,
            cancelled_at,
            ended_at,
            cancelled,
            ended_early,
            original_nickname,
            loa_nickname,
            nickname_modified,
          ] = params;

          const record = {
            id,
            guild_id,
            user_id,
            display_name,
            start_date,
            end_date,
            reason,
            created_at,
            updated_at,
            cancelled_at,
            ended_at,
            cancelled,
            ended_early,
            original_nickname: original_nickname || null,
            loa_nickname: loa_nickname || null,
            nickname_modified: nickname_modified ? 1 : 0,
            removed_role_ids: null,
            restored_role_ids: null,
            failed_restore_role_ids: null,
            preserved_role_ids: null,
            role_swap_status: "none",
            role_restore_status: "none",
            role_swap_completed_at: null,
            role_restore_completed_at: null,
            role_swap_error: null,
            role_restore_error: null,
            is_legacy_snapshot: 0,
            is_protected_staff: 0,
            assigned_loa_role_id: null,
          };
          mockStorage.records.set(id, record);
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("SET removed_role_ids = ?")
        ) {
          const loaId = params[params.length - 1];
          const rec = mockStorage.records.get(loaId);
          if (rec) {
            rec.removed_role_ids = params[0];
            rec.preserved_role_ids = params[1];
            rec.role_swap_status = params[2];
            rec.role_swap_completed_at = params[3];
            if (normalized.includes("is_protected_staff = ?")) {
              rec.role_swap_error = params[4];
              rec.is_protected_staff = params[5];
              rec.assigned_loa_role_id = params[6];
            } else if (normalized.includes("role_swap_error = ?")) {
              rec.role_swap_error = params[4];
            } else if (normalized.includes("is_legacy_snapshot = ?")) {
              rec.is_legacy_snapshot = params[4];
            }
          }
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("SET restored_role_ids = ?")
        ) {
          const loaId = params[params.length - 1];
          const rec = mockStorage.records.get(loaId);
          if (rec) {
            rec.restored_role_ids = params[0];
            rec.failed_restore_role_ids = params[1];
            rec.role_restore_status = params[2];
            rec.role_restore_completed_at = params[3];
            rec.role_restore_error = params[4];
            rec.is_legacy_snapshot = params[5];
          }
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("SET original_nickname = ?")
        ) {
          const [original_nickname, loa_nickname, nickname_modified, loaId] = params;
          const rec = mockStorage.records.get(loaId);
          if (rec) {
            rec.original_nickname = original_nickname;
            rec.loa_nickname = loa_nickname;
            rec.nickname_modified = nickname_modified;
          }
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("SET display_name = ?")
        ) {
          const [
            display_name,
            start_date,
            end_date,
            reason,
            updated_at,
            loaId,
            userId,
          ] = params;
          const rec = mockStorage.records.get(loaId);
          if (rec && rec.user_id === userId) {
            rec.display_name = display_name;
            rec.start_date = start_date;
            rec.end_date = end_date;
            rec.reason = reason;
            rec.updated_at = updated_at;
          }
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("SET cancelled = 1")
        ) {
          const [cancelled_at, updated_at, loaId, userId] = params;
          const rec = mockStorage.records.get(loaId);
          if (rec && rec.user_id === userId) {
            rec.cancelled = 1;
            rec.cancelled_at = cancelled_at;
            rec.updated_at = updated_at;
          }
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("SET ended_early = 1")
        ) {
          const [ended_at, updated_at, loaId, userId] = params;
          const rec = mockStorage.records.get(loaId);
          if (rec && rec.user_id === userId) {
            rec.ended_early = 1;
            rec.ended_at = ended_at;
            rec.updated_at = updated_at;
          }
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("SET end_date = ?")
        ) {
          const [
            newEndDate,
            updatedReason,
            originalReturn,
            historyJson,
            modifiedBy,
            modifiedAt,
            updatedAt,
            loaId,
          ] = params;
          const rec = mockStorage.records.get(loaId);
          if (rec) {
            rec.end_date = newEndDate;
            rec.reason = updatedReason;
            rec.original_expected_return_date = originalReturn;
            rec.extension_history = historyJson;
            rec.modified_by = modifiedBy;
            rec.modified_at = modifiedAt;
            rec.updated_at = updatedAt;
            rec.reminder_sent = 0;
          }
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("SET reason = ?")
        ) {
          const [
            newReason,
            historyJson,
            modifiedBy,
            modifiedAt,
            updatedAt,
            loaId,
          ] = params;
          const rec = mockStorage.records.get(loaId);
          if (rec) {
            rec.reason = newReason;
            rec.reason_history = historyJson;
            rec.modified_by = modifiedBy;
            rec.modified_at = modifiedAt;
            rec.updated_at = updatedAt;
          }
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("return_type = 'ADMIN_ENDED'")
        ) {
          const [endedAt, actualReturnAt, adminUserId, modifiedAt, updatedAt, loaId] = params;
          const rec = mockStorage.records.get(loaId);
          if (rec) {
            rec.ended_at = endedAt;
            rec.actual_return_at = actualReturnAt;
            rec.return_type = "ADMIN_ENDED";
            rec.modified_by = adminUserId;
            rec.modified_at = modifiedAt;
            rec.updated_at = updatedAt;
          }
          return [];
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("return_type = 'EARLY_RETURN'")
        ) {
          const [endedAt, loaId] = params;
          const rec = mockStorage.records.get(loaId);
          if (rec) {
            rec.actual_return_at = endedAt;
            rec.return_type = "EARLY_RETURN";
          }
          return [];
        }

        if (
          normalized.includes("SELECT * FROM staff_loas") &&
          normalized.includes("nickname_modified = 1")
        ) {
          const [todayIso] = params;
          const list = [];
          for (const rec of mockStorage.records.values()) {
            if (
              rec.nickname_modified === 1 &&
              (rec.end_date < todayIso ||
                rec.cancelled === 1 ||
                rec.ended_early === 1 ||
                rec.ended_at)
            ) {
              list.push({ ...rec });
            }
          }
          list.sort((a, b) => a.end_date.localeCompare(b.end_date));
          return list;
        }

        if (
          normalized.includes("SELECT * FROM staff_loas") &&
          normalized.includes("nickname_modified = 0")
        ) {
          const [todayIso1, todayIso2] = params;
          const list = [];
          for (const rec of mockStorage.records.values()) {
            if (
              rec.start_date <= todayIso1 &&
              rec.end_date >= todayIso2 &&
              rec.cancelled === 0 &&
              rec.ended_early === 0 &&
              !rec.ended_at &&
              !rec.nickname_modified
            ) {
              list.push({ ...rec });
            }
          }
          list.sort((a, b) => a.start_date.localeCompare(b.start_date));
          return list;
        }

        if (
          normalized.includes("SELECT * FROM staff_loas") &&
          normalized.includes("reminder_sent")
        ) {
          const [todayIso, tomorrowIso] = params;
          const list = [];
          for (const rec of mockStorage.records.values()) {
            if (
              rec.start_date <= todayIso &&
              rec.end_date <= tomorrowIso &&
              rec.end_date >= todayIso &&
              rec.cancelled === 0 &&
              rec.ended_early === 0 &&
              !rec.ended_at &&
              (!rec.reminder_sent || rec.reminder_sent === 0)
            ) {
              list.push({ ...rec });
            }
          }
          return list;
        }

        if (
          normalized.includes("UPDATE staff_loas") &&
          normalized.includes("reminder_sent = 1")
        ) {
          const [loaId] = params;
          const rec = mockStorage.records.get(loaId);
          if (rec) rec.reminder_sent = 1;
          return [];
        }

        if (
          normalized.includes("SELECT * FROM staff_loas") &&
          normalized.includes("end_date >= ?") &&
          !normalized.includes("user_id = ?") &&
          !normalized.includes("nickname_modified") &&
          !normalized.includes("reminder_sent")
        ) {
          const [todayIso1, todayIso2] = params;
          const today = todayIso1;
          const activeList = [];
          for (const rec of mockStorage.records.values()) {
            if (
              rec.end_date >= today &&
              rec.cancelled === 0 &&
              rec.ended_early === 0 &&
              !rec.ended_at
            ) {
              activeList.push({ ...rec });
            }
          }
          activeList.sort((a, b) => {
            const aActive = a.start_date <= today ? 0 : 1;
            const bActive = b.start_date <= today ? 0 : 1;
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

        // Subscription queries
        if (normalized.includes("SELECT 1 FROM loa_subscriptions WHERE loa_id = ? AND subscriber_user_id = ?")) {
          const [loaId, userId] = params;
          const exists = mockStorage.subscriptions.has(`${loaId}:${userId}`);
          return exists ? [{ 1: 1 }] : [];
        }

        if (normalized.includes("INSERT INTO loa_subscriptions")) {
          const [loaId, userId, guildId, createdAt] = params;
          mockStorage.subscriptions.set(`${loaId}:${userId}`, { loaId, userId, guildId, createdAt });
          return [];
        }

        if (normalized.includes("DELETE FROM loa_subscriptions WHERE loa_id = ? AND subscriber_user_id = ?")) {
          const [loaId, userId] = params;
          mockStorage.subscriptions.delete(`${loaId}:${userId}`);
          return [];
        }

        if (normalized.includes("SELECT subscriber_user_id FROM loa_subscriptions WHERE loa_id = ?")) {
          const [loaId] = params;
          const subs = [];
          for (const s of mockStorage.subscriptions.values()) {
            if (s.loaId === loaId) subs.push({ subscriber_user_id: s.userId });
          }
          return subs;
        }

        if (normalized.includes("DELETE FROM loa_subscriptions WHERE loa_id = ?")) {
          const [loaId] = params;
          for (const [key, s] of mockStorage.subscriptions.entries()) {
            if (s.loaId === loaId) mockStorage.subscriptions.delete(key);
          }
          return [];
        }

        if (normalized.includes("SELECT loa_id FROM loa_subscriptions WHERE subscriber_user_id = ?")) {
          const [userId] = params;
          const subs = [];
          for (const s of mockStorage.subscriptions.values()) {
            if (s.userId === userId) subs.push({ loa_id: s.loaId });
          }
          return subs;
        }

        return [];
      },
    },
  };

  const ctx = { storage: mockStorage };
  const instance = new StaffLoaDO(ctx, env);
  return { instance, mockStorage };
}

function createMockEnvironment(
  publicKeyHex,
  doInstancesByGuild = new Map(),
  staffRoleId = TEST_STAFF_ROLE_ID,
  loaChannelId = TEST_LOA_CHANNEL_ID,
  botToken = "mock_bot_token"
) {
  return {
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_BOT_TOKEN: botToken,
    STAFF_TEAM_ROLE_ID: staffRoleId,
    LOA_CHANNEL_ID: loaChannelId,
    STAFF_LOA: {
      idFromName: (guildId) => guildId || "default",
      get: (guildId) => {
        let entry = doInstancesByGuild.get(guildId);
        if (!entry) {
          entry = createMockLoaDO();
          doInstancesByGuild.set(guildId, entry);
        }
        return {
          fetch: (reqUrl, reqOpt) =>
            entry.instance.fetch(new Request(reqUrl, reqOpt)),
        };
      },
    },
  };
}

// Helper to extract all text display contents from a Container component (including inside Sections)
function getContainerTexts(container) {
  if (!container || !Array.isArray(container.components)) return "";
  const texts = [];
  for (const comp of container.components) {
    if (comp.type === ComponentType.TEXT_DISPLAY) {
      texts.push(comp.content);
    } else if (comp.type === ComponentType.SECTION && Array.isArray(comp.components)) {
      for (const sub of comp.components) {
        if (sub.type === ComponentType.TEXT_DISPLAY) {
          texts.push(sub.content);
        }
      }
    }
  }
  return texts.join("\n\n");
}

// ============================================================================
// DATE & TIMEZONE UNIT TESTS
// ============================================================================

test("Date utils: isLeapYear accurately identifies leap years", () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2028), true);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(2025), false);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2100), false);
});

test("Date utils: getDaysInMonth accurately returns days for months", () => {
  assert.equal(getDaysInMonth(1, 2026), 31);
  assert.equal(getDaysInMonth(2, 2026), 28);
  assert.equal(getDaysInMonth(2, 2028), 29);
  assert.equal(getDaysInMonth(4, 2026), 30);
  assert.equal(getDaysInMonth(12, 2026), 31);
});

test("Date utils: parseAndValidateDate validates all supported flexible date formats", () => {
  const referenceDate = "2026-09-01";

  for (const input of ["9/1/2026", "09/01/2026", "9/01/2026", "09/1/2026"]) {
    const res = parseAndValidateDate(input, referenceDate);
    assert.equal(res.valid, true, `${input} should be valid`);
    assert.equal(res.isoDate, "2026-09-01");
    assert.equal(res.displayDate, "09/01/2026");
  }

  for (const input of ["9-1-2026", "09-01-2026", "9-01-2026", "09-1-2026"]) {
    const res = parseAndValidateDate(input, referenceDate);
    assert.equal(res.valid, true, `${input} should be valid`);
    assert.equal(res.isoDate, "2026-09-01");
    assert.equal(res.displayDate, "09/01/2026");
  }

  for (const input of ["9/1/26", "09/01/26", "9-1-26", "09-01-26"]) {
    const res = parseAndValidateDate(input, referenceDate);
    assert.equal(res.valid, true, `${input} should be valid`);
    assert.equal(res.isoDate, "2026-09-01");
    assert.equal(res.displayDate, "09/01/2026");
  }

  for (const input of ["2026-09-01", "2026/09/01"]) {
    const res = parseAndValidateDate(input, referenceDate);
    assert.equal(res.valid, true, `${input} should be valid`);
    assert.equal(res.isoDate, "2026-09-01");
    assert.equal(res.displayDate, "09/01/2026");
  }

  for (const input of ["9/1", "09/01", "9-1", "09-01"]) {
    const res = parseAndValidateDate(input, referenceDate);
    assert.equal(res.valid, true, `${input} should be valid`);
    assert.equal(res.isoDate, "2026-09-01");
    assert.equal(res.displayDate, "09/01/2026");
  }

  const resPast = parseAndValidateDate("8/15", referenceDate);
  assert.equal(resPast.valid, true);
  assert.equal(resPast.isoDate, "2027-08-15");
  assert.equal(resPast.displayDate, "08/15/2027");

  const resLeapValid = parseAndValidateDate("02/29/2028", referenceDate);
  assert.equal(resLeapValid.valid, true);
  assert.equal(resLeapValid.isoDate, "2028-02-29");

  const resLeapInvalid = parseAndValidateDate("02/29/2026", referenceDate);
  assert.equal(resLeapInvalid.valid, false);
});

test("Date utils: formatPrettyDate, formatPrettyDateRange, and formatCompactDateRange", () => {
  assert.equal(formatPrettyDate("2026-09-01"), "Sep 1, 2026");
  assert.equal(formatPrettyDate("2026-12-31"), "Dec 31, 2026");
  assert.equal(
    formatPrettyDateRange("2026-09-01", "2026-09-08"),
    "Sep 1, 2026 → Sep 8, 2026"
  );
  assert.equal(
    formatCompactDateRange("2026-09-01", "2026-09-08"),
    "Sep 1 → Sep 8"
  );
  assert.equal(
    formatCompactDateRange("2026-12-28", "2027-01-05"),
    "Dec 28, 2026 → Jan 5, 2027"
  );
});

test("Date utils: getTodayInChicago returns America/Chicago calendar date", () => {
  const dateEveningCDT = new Date("2026-09-02T02:30:00Z");
  const chicagoDate = getTodayInChicago(dateEveningCDT);
  assert.equal(chicagoDate, "2026-09-01");

  const dateMorningCDT = new Date("2026-09-02T06:00:00Z");
  assert.equal(getTodayInChicago(dateMorningCDT), "2026-09-02");
});

test("Date utils: getLoaStatus dynamically determines status", () => {
  const today = "2026-09-05";

  assert.equal(
    getLoaStatus({ start_date: "2026-09-10", end_date: "2026-09-15" }, today).code,
    "UPCOMING"
  );
  assert.equal(
    getLoaStatus({ start_date: "2026-09-05", end_date: "2026-09-10" }, today).code,
    "ACTIVE"
  );
  assert.equal(
    getLoaStatus({ start_date: "2026-09-01", end_date: "2026-09-10" }, today).code,
    "ACTIVE"
  );
  assert.equal(
    getLoaStatus({ start_date: "2026-08-20", end_date: "2026-08-30" }, today).code,
    "COMPLETED"
  );
  assert.equal(
    getLoaStatus({ start_date: "2026-09-10", end_date: "2026-09-15", cancelled: 1 }, today).code,
    "CANCELLED"
  );
  assert.equal(
    getLoaStatus({ start_date: "2026-09-01", end_date: "2026-09-15", ended_early: 1 }, today).code,
    "ENDED_EARLY"
  );
});

// ============================================================================
// PUBLIC LOA LIST & CONTROL PANEL LAYOUT TESTS
// ============================================================================

test("PUBLIC LIST LAYOUT: Container contains all 4 action buttons even when list is empty", () => {
  const containers = buildLoaListContainers([]);
  assert.equal(containers.length, 1);

  const container = containers[0];
  assert.equal(container.type, ComponentType.CONTAINER);
  assert.equal(container.accent_color, VITAL_ORANGE);

  // Check buttons
  const actionRows = container.components.filter(
    (c) => c.type === ComponentType.ACTION_ROW
  );
  assert.equal(actionRows.length, 1, "Must contain 1 Action Row of buttons");

  const buttons = actionRows.flatMap((r) => r.components);
  assert.equal(buttons.length, 5, "Must contain all 5 LOA control buttons");

  const customIds = buttons.map((b) => b.custom_id);
  assert.deepEqual(customIds, [
    LoaCustomId.BTN_START,
    LoaCustomId.BTN_ACTIVE,
    LoaCustomId.BTN_STATUS,
    LoaCustomId.BTN_HISTORY,
    LoaCustomId.BTN_REFRESH,
  ]);

  // Check header Section has Vital RP logo Thumbnail accessory
  const headerSection = container.components.find((c) => c.type === ComponentType.SECTION);
  assert.ok(headerSection, "Must contain a Section component for the header");
  assert.equal(headerSection.accessory?.type, ComponentType.THUMBNAIL);
  assert.equal(headerSection.accessory?.media?.url, VITAL_RP_LOGO_URL);

  const text = getContainerTexts(container);
  assert.ok(text.includes("# 🏖️ Staff LOA Center"));
  assert.ok(text.includes("🟢 No staff members are currently on LOA."));
  assert.ok(text.includes("Suspicious levels of staff availability detected."));
});

test("PUBLIC LIST LAYOUT: Container includes active staff, returning count, and optional recent activity line", () => {
  const sampleLoas = [
    {
      display_name: "Damon",
      start_date: "2026-09-02",
      end_date: "2026-09-02", // Returning today
      reason: "Vacation",
    },
    {
      display_name: "MrCarlile",
      start_date: "2026-09-01",
      end_date: "2026-09-08",
      reason: "Mental health break",
    },
  ];

  const recentActivity = "✏️ Damon updated their LOA • just now";
  const containers = buildLoaListContainers(sampleLoas, recentActivity, "2026-09-02");
  assert.equal(containers.length, 1);

  const container = containers[0];
  const text = getContainerTexts(container);

  assert.ok(text.includes("# 🏖️ Staff LOA Center"));
  assert.ok(text.includes("2 staff members are currently away"));
  assert.ok(text.includes("1 staff member returning today"));
  assert.ok(text.includes("🟢 **Damon**"));
  assert.ok(text.includes("Returns today"));
  assert.ok(text.includes("> Vacation"));
  assert.ok(text.includes("🟢 **MrCarlile**"));
  assert.ok(text.includes("Sep 1 → Sep 8"));
  assert.ok(text.includes("> Mental health break"));
  assert.ok(text.includes("-# ✏️ Damon updated their LOA • just now"));
  assert.ok(text.includes("Damo Bot • Staff LOA Manager"));
  assert.ok(text.includes(DAMO_BOT_VERSION));

  // Check header Section with Vital RP Thumbnail accessory
  const headerSection = container.components.find((c) => c.type === ComponentType.SECTION);
  assert.ok(headerSection, "Must contain a Section component for the header");
  assert.equal(headerSection.accessory?.type, ComponentType.THUMBNAIL);
  assert.equal(headerSection.accessory?.media?.url, VITAL_RP_LOGO_URL);

  // Check buttons are present
  const actionRows = container.components.filter(
    (c) => c.type === ComponentType.ACTION_ROW
  );
  assert.equal(actionRows.length, 1);
});

// ============================================================================
// CHANNEL & ROLE RESTRICTIONS TESTS (BUTTONS, MODALS, COMMANDS)
// ============================================================================

test("SECURITY: Button click in wrong channel is rejected ephemerally and DO is untouched", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const doEntry = createMockLoaDO();
  guildMap.set("guild_vital", doEntry);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: OTHER_CHANNEL_ID, // WRONG CHANNEL
    member: {
      user: { id: "staff_1", username: "StaffOne" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: {
      custom_id: LoaCustomId.BTN_START,
    },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.equal(
    json.data.content,
    "❌ LOA commands can only be used in the designated LOA channel."
  );
  assert.equal(doEntry.mockStorage.getQueryCount(), 0);
});

test("SECURITY: Non-staff member clicking button is rejected ephemerally", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const env = createMockEnvironment(pubHex);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "non_staff_user", username: "NonStaff" },
      roles: ["other_role_id"],
    },
    data: {
      custom_id: LoaCustomId.BTN_START,
    },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.equal(
    json.data.content,
    "❌ This command is only available to Vital RP staff."
  );
});

test("SECURITY: Owner role member (DEFAULT_OWNER_ROLE_ID) without StaffTeam role can access LOA commands", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const env = createMockEnvironment(pubHex);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "owner_user", username: "OwnerUser" },
      roles: [DEFAULT_OWNER_ROLE_ID],
    },
    data: {
      custom_id: LoaCustomId.BTN_START,
    },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.type, InteractionResponseType.MODAL);
  assert.equal(json.data.title, "Start Leave of Absence");
});

// ============================================================================
// START LOA FLOW (BUTTON -> MODAL -> SUBMIT -> REBUILD LIST)
// ============================================================================

test("START FLOW: Clicking [ 🏖️ Start LOA ] returns private modal", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const env = createMockEnvironment(pubHex);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_damon", username: "damon" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: {
      custom_id: LoaCustomId.BTN_START,
    },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(json.type, InteractionResponseType.MODAL);
  assert.equal(json.data.custom_id, LoaCustomId.MODAL_START);
  assert.equal(json.data.title, "Start Leave of Absence");
  assert.equal(json.data.components.length, 4);
  assert.equal(json.data.components[0].components[0].custom_id, "start_date");
  assert.equal(json.data.components[1].components[0].custom_id, "end_date");
  assert.equal(json.data.components[2].components[0].custom_id, "reason");
  assert.equal(json.data.components[3].components[0].custom_id, "notes");
});

test("START FLOW: Submitting start modal creates LOA, replaces public list, and returns private confirmation", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  // Mock global fetch for Discord API calls
  const originalFetch = globalThis.fetch;
  const postedMessages = [];
  const deletedMessages = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes(`/channels/${TEST_LOA_CHANNEL_ID}/messages`) && options.method === "POST") {
      const parsedBody = JSON.parse(options.body);
      const msgId = `msg_${Date.now()}_${Math.random()}`;
      postedMessages.push({ id: msgId, ...parsedBody });
      return new Response(JSON.stringify({ id: msgId }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && options.method === "DELETE") {
      const msgId = urlStr.split("/").pop();
      deletedMessages.push(msgId);
      return new Response(null, { status: 204 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MODAL_SUBMIT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "Damon",
        user: { id: "staff_damon", username: "damon" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        custom_id: LoaCustomId.MODAL_START,
        components: [
          {
            type: 1,
            components: [{ custom_id: "start_date", value: "09/02/2026" }],
          },
          {
            type: 1,
            components: [{ custom_id: "end_date", value: "09/30/2026" }],
          },
          {
            type: 1,
            components: [{ custom_id: "reason", value: "Vacation" }],
          },
        ],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
    const json = await res.json();

    // Private ephemeral confirmation returned to user
    assert.equal(json.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
    const confirmationText = getContainerTexts(json.data.components[0]);
    assert.ok(confirmationText.includes("# 🏖️ Leave of Absence Submitted"));
    assert.ok(confirmationText.includes("Sep 2, 2026 → Sep 30, 2026"));
    assert.ok(confirmationText.includes("Vacation"));

    // Public list posted via Discord API
    const publicContainer = postedMessages[0].components[0];
    const publicText = getContainerTexts(publicContainer);
    assert.ok(publicText.includes("🟢 **Damon**"));
    assert.ok(publicText.includes("Sep 2 → Sep 30"));
    assert.ok(publicText.includes("> Vacation"));
    assert.ok(publicText.includes("-# 🏖️ Damon started an LOA • just now"));

    // Verify record in DO
    const doEntry = guildMap.get("guild_vital");
    const rec = doEntry.instance.getActiveOrUpcomingLoa("staff_damon", "2026-09-02");
    assert.ok(rec != null);
    assert.equal(rec.reason, "Vacation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("START FLOW: Clicking [ 🏖️ Start LOA ] when already on LOA returns rejection", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_1",
    guildId: "guild_vital",
    userId: "staff_damon",
    displayName: "Damon",
    startDate: "2026-09-02",
    endDate: "2026-09-30",
    reason: "Vacation",
    todayIso: "2026-09-02",
  });
  guildMap.set("guild_vital", doEntry);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_damon" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: { custom_id: LoaCustomId.BTN_START },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  const json = await res.json();
  assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
  assert.ok(json.data.content.includes("You already have an active or upcoming LOA"));
});

// ============================================================================
// EDIT LOA FLOW (BUTTON -> MODAL -> SUBMIT -> REBUILD LIST)
// ============================================================================

test("EDIT FLOW: Clicking [ ✏️ Edit My LOA ] looks up invoking user and returns modal with pre-populated values", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_damon_1",
    guildId: "guild_vital",
    userId: "staff_damon",
    displayName: "Damon",
    startDate: "2026-09-02",
    endDate: "2026-09-30",
    reason: "Vacation",
    todayIso: "2026-09-02",
  });
  guildMap.set("guild_vital", doEntry);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_damon" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: { custom_id: LoaCustomId.BTN_EDIT },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  const json = await res.json();

  assert.equal(json.type, InteractionResponseType.MODAL);
  assert.equal(json.data.custom_id, `${LoaCustomId.MODAL_EDIT_PREFIX}:loa_damon_1`);
  assert.equal(json.data.components[0].components[0].value, "09/02/2026");
  assert.equal(json.data.components[1].components[0].value, "09/30/2026");
  assert.equal(json.data.components[2].components[0].value, "Vacation");
});

test("EDIT FLOW: Submitting edit modal updates LOA, deletes previous public list, posts new list with changes", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_damon_1",
    guildId: "guild_vital",
    userId: "staff_damon",
    displayName: "Damon",
    startDate: "2026-09-02",
    endDate: "2026-09-30",
    reason: "Vacation",
    todayIso: "2026-09-02",
  });
  doEntry.instance.setMeta("last_list_message_id", "msg_old_12345");
  guildMap.set("guild_vital", doEntry);

  const originalFetch = globalThis.fetch;
  const postedMessages = [];
  const patchedMessages = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "PATCH") {
      const parsedBody = JSON.parse(options.body);
      patchedMessages.push({ url: urlStr, ...parsedBody });
      return new Response(JSON.stringify({ id: "msg_old_12345" }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      const parsedBody = JSON.parse(options.body);
      const msgId = "msg_new_67890";
      postedMessages.push({ id: msgId, ...parsedBody });
      return new Response(JSON.stringify({ id: msgId }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MODAL_SUBMIT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "Damon",
        user: { id: "staff_damon" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        custom_id: `${LoaCustomId.MODAL_EDIT_PREFIX}:loa_damon_1`,
        components: [
          {
            type: 1,
            components: [{ custom_id: "start_date", value: "09/02/2026" }],
          },
          {
            type: 1,
            components: [{ custom_id: "end_date", value: "09/18/2026" }],
          },
          {
            type: 1,
            components: [{ custom_id: "reason", value: "Family stuff" }],
          },
        ],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);

    // Existing permanent dashboard updated in place via PATCH
    assert.equal(patchedMessages.length, 1);
    assert.ok(patchedMessages[0].url.includes("msg_old_12345"));

    const publicContainer = patchedMessages[0].components[0];
    const publicText = getContainerTexts(publicContainer);
    assert.ok(publicText.includes("Sep 2 → Sep 18"));
    assert.ok(publicText.includes("> Family stuff"));
    assert.ok(publicText.includes("-# ✏️ Damon updated their LOA • just now"));

    // Stored message ID remains the permanent dashboard ID
    assert.equal(doEntry.instance.getMeta("last_list_message_id"), "msg_old_12345");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// CANCEL / RETURN EARLY FLOW
// ============================================================================

test("CANCEL FLOW: Upcoming LOA shows private confirmation [ Never Mind ] [ ❌ Cancel LOA ]", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const today = getTodayInChicago();
  const [y, m, d] = today.split("-").map(Number);
  const futureStart = new Date(Date.UTC(y, m - 1, d + 3)).toISOString().slice(0, 10);
  const futureEnd = new Date(Date.UTC(y, m - 1, d + 8)).toISOString().slice(0, 10);

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_upcoming_1",
    guildId: "guild_vital",
    userId: "staff_upcoming",
    displayName: "UpcomingStaff",
    startDate: futureStart,
    endDate: futureEnd,
    reason: "Trip",
    todayIso: today,
  });
  guildMap.set("guild_vital", doEntry);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_upcoming" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: { custom_id: LoaCustomId.BTN_CANCEL },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  const json = await res.json();
  assert.equal(json.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);

  const container = json.data.components[0];
  const text = getContainerTexts(container);
  assert.ok(text.includes("# ⚠️ Cancel Your LOA?"));
  assert.ok(text.includes(formatPrettyDateRange(futureStart, futureEnd)));
  assert.ok(text.includes("> Trip"));

  const buttons = container.components.find((c) => c.type === ComponentType.ACTION_ROW).components;
  assert.equal(buttons[0].custom_id, LoaCustomId.CANCEL_DISMISS);
  assert.equal(buttons[1].custom_id, "loa_confirm_cancel:loa_upcoming_1");
});

test("CANCEL FLOW: Active LOA shows private confirmation [ Never Mind ] [ ✅ I'm Back ]", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_active_1",
    guildId: "guild_vital",
    userId: "staff_active",
    displayName: "ActiveStaff",
    startDate: "2026-09-01",
    endDate: "2026-09-18",
    reason: "Vacation",
    todayIso: "2026-09-02",
  });
  guildMap.set("guild_vital", doEntry);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_active" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: { custom_id: LoaCustomId.BTN_CANCEL },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  const json = await res.json();
  assert.equal(json.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);

  const container = json.data.components[0];
  const text = getContainerTexts(container);
  assert.ok(text.includes("# ⚠️ Return Early?"));
  assert.ok(text.includes("Your original return date is Sep 18, 2026."));

  const buttons = container.components.find((c) => c.type === ComponentType.ACTION_ROW).components;
  assert.equal(buttons[0].custom_id, LoaCustomId.CANCEL_DISMISS);
  assert.equal(buttons[1].custom_id, "loa_confirm_return:loa_active_1");
});

test("CANCEL FLOW: Confirming cancel on upcoming LOA cancels record, updates public list, and preserves history", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_upcoming_2",
    guildId: "guild_vital",
    userId: "staff_upcoming_2",
    displayName: "Damon",
    startDate: "2026-09-10",
    endDate: "2026-09-15",
    reason: "Trip",
    todayIso: "2026-09-02",
  });
  guildMap.set("guild_vital", doEntry);

  const originalFetch = globalThis.fetch;
  const postedMessages = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      const parsedBody = JSON.parse(options.body);
      postedMessages.push(parsedBody);
      return new Response(JSON.stringify({ id: "msg_new" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "Damon",
        user: { id: "staff_upcoming_2" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: { custom_id: "loa_confirm_cancel:loa_upcoming_2" },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    const json = await res.json();

    assert.equal(json.type, InteractionResponseType.UPDATE_MESSAGE);
    const container = json.data.components[0];
    assert.ok(getContainerTexts(container).includes("# ❌ Leave of Absence Cancelled"));

    // Verify record in history has cancelled = 1
    const rec = doEntry.instance.getLoaById("loa_upcoming_2");
    assert.equal(rec.cancelled, 1);
    assert.ok(rec.cancelled_at != null);

    // Verify public list updated
    assert.equal(postedMessages.length, 1);
    const publicText = getContainerTexts(postedMessages[0].components[0]);
    assert.ok(publicText.includes("-# ❌ Damon cancelled their upcoming LOA • just now"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CANCEL FLOW: Confirming early return on active LOA ends record early and updates public list", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_active_2",
    guildId: "guild_vital",
    userId: "staff_active_2",
    displayName: "Damon",
    startDate: "2026-09-01",
    endDate: "2026-09-08",
    reason: "Vacation",
    todayIso: "2026-09-02",
  });
  guildMap.set("guild_vital", doEntry);

  const originalFetch = globalThis.fetch;
  const postedMessages = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes(`/channels/${TEST_LOA_CHANNEL_ID}/messages`) && options.method === "POST") {
      const parsedBody = JSON.parse(options.body);
      postedMessages.push(parsedBody);
      return new Response(JSON.stringify({ id: "msg_new" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "Damon",
        user: { id: "staff_active_2" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: { custom_id: "loa_confirm_return:loa_active_2" },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    const json = await res.json();

    assert.equal(json.type, InteractionResponseType.UPDATE_MESSAGE);
    const container = json.data.components[0];
    assert.ok(getContainerTexts(container).includes("# ✅ Welcome Back"));

    // Verify record in history has ended_early = 1
    const rec = doEntry.instance.getLoaById("loa_active_2");
    assert.equal(rec.ended_early, 1);
    assert.ok(rec.ended_at != null);

    // Verify public list updated
    assert.equal(postedMessages.length, 1);
    const publicText = getContainerTexts(postedMessages[0].components[0]);
    assert.ok(publicText.includes("-# ✅ Damon returned from LOA early • just now"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// STATUS & REFRESH BUTTONS
// ============================================================================

test("STATUS BUTTON: [ 👤 My LOA ] returns private status container", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const today = getTodayInChicago();
  const [y, m, d] = today.split("-").map(Number);
  const activeStart = new Date(Date.UTC(y, m - 1, d - 2)).toISOString().slice(0, 10);
  const activeEnd = new Date(Date.UTC(y, m - 1, d + 5)).toISOString().slice(0, 10);

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_my",
    guildId: "guild_vital",
    userId: "staff_my",
    displayName: "MyStaff",
    startDate: activeStart,
    endDate: activeEnd,
    reason: "Rest",
    todayIso: activeStart,
  });
  guildMap.set("guild_vital", doEntry);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_my" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: { custom_id: LoaCustomId.BTN_STATUS },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  const json = await res.json();
  assert.equal(json.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
  const text = getContainerTexts(json.data.components[0]);
  assert.ok(text.includes("# 🏖️ Your LOA"));
  assert.ok(text.includes("🟢 Active"));
  assert.ok(text.includes(formatPrettyDateRange(activeStart, activeEnd)));
});

test("REFRESH BUTTON: [ 🔄 Refresh ] rebuilds public list in channel and responds ephemerally", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const env = createMockEnvironment(pubHex);

  const originalFetch = globalThis.fetch;
  let postCalled = false;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      postCalled = true;
      return new Response(JSON.stringify({ id: "msg_refreshed" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_refresher" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: { custom_id: LoaCustomId.BTN_REFRESH },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    const json = await res.json();
    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.equal(json.data.content, "✅ Staff LOA Center refreshed.");
    assert.equal(postCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// SLASH COMMANDS BACKWARDS COMPATIBILITY
// ============================================================================

test("SLASH COMMAND: /loa start records LOA, replaces public list, and returns ephemeral response", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const originalFetch = globalThis.fetch;
  const postedMessages = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes(`/channels/${TEST_LOA_CHANNEL_ID}/messages`) && options.method === "POST") {
      postedMessages.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "msg_slash_1" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "Damo Officer",
        user: { id: "staff_slash_1" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [
          {
            name: "start",
            options: [
              { name: "start_date", value: "09/05/2026" },
              { name: "end_date", value: "09/12/2026" },
              { name: "reason", value: "Training" },
            ],
          },
        ],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    const json = await res.json();

    // Must be EPHEMERAL
    assert.equal(json.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
    const text = getContainerTexts(json.data.components[0]);
    assert.ok(text.includes("# 🏖️ Leave of Absence Submitted"));
    assert.ok(text.includes("Sep 5, 2026 → Sep 12, 2026"));
    assert.equal(postedMessages.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SLASH COMMAND: /loa edit updates LOA, replaces public list, and returns ephemeral response", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const today = getTodayInChicago();
  const [y, m, d] = today.split("-").map(Number);
  const futureStart = new Date(Date.UTC(y, m - 1, d + 3)).toISOString().slice(0, 10);
  const futureEnd = new Date(Date.UTC(y, m - 1, d + 8)).toISOString().slice(0, 10);
  const futureEndEdit = new Date(Date.UTC(y, m - 1, d + 12)).toISOString().slice(0, 10);
  const [ey, em, ed] = futureEndEdit.split("-");
  const editEndDateStr = `${em}/${ed}/${ey}`;

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_slash_edit",
    guildId: "guild_vital",
    userId: "staff_slash_edit",
    displayName: "Damo",
    startDate: futureStart,
    endDate: futureEnd,
    reason: "Training",
    todayIso: today,
  });
  guildMap.set("guild_vital", doEntry);

  const originalFetch = globalThis.fetch;
  const postedMessages = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      postedMessages.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "msg_slash_edit" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "Damo",
        user: { id: "staff_slash_edit" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [
          {
            name: "edit",
            options: [
              { name: "end_date", value: editEndDateStr },
              { name: "reason", value: "Extended training" },
            ],
          },
        ],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    const json = await res.json();

    assert.equal(json.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
    const text = getContainerTexts(json.data.components[0]);
    assert.ok(text.includes("# ✏️ Leave of Absence Updated"));
    assert.ok(text.includes(formatPrettyDateRange(futureStart, futureEndEdit)));
    assert.ok(text.includes("> Extended training"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SLASH COMMAND: /loa cancel cancels LOA and returns ephemeral response", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const today = getTodayInChicago();
  const [y, m, d] = today.split("-").map(Number);
  const futureStart = new Date(Date.UTC(y, m - 1, d + 3)).toISOString().slice(0, 10);
  const futureEnd = new Date(Date.UTC(y, m - 1, d + 8)).toISOString().slice(0, 10);

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_slash_cancel",
    guildId: "guild_vital",
    userId: "staff_slash_2",
    displayName: "Damo",
    startDate: futureStart,
    endDate: futureEnd,
    reason: "Trip",
    todayIso: today,
  });
  guildMap.set("guild_vital", doEntry);

  const originalFetch = globalThis.fetch;
  const postedMessages = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      postedMessages.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "msg_slash_2" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_slash_2" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [{ name: "cancel" }],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    const json = await res.json();
    assert.equal(json.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
    const text = getContainerTexts(json.data.components[0]);
    assert.ok(text.includes("# ❌ Leave of Absence Cancelled"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SLASH COMMAND: /loa list refreshes public list and returns ephemeral confirmation", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const env = createMockEnvironment(pubHex);

  const originalFetch = globalThis.fetch;
  let postCalled = false;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      postCalled = true;
      return new Response(JSON.stringify({ id: "msg_slash_list" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_slash_list" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [{ name: "list" }],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    const json = await res.json();
    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.equal(json.data.content, "✅ Staff LOA Center refreshed.");
    assert.equal(postCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =============================================================================
// NICKNAME MANAGEMENT TESTS
// =============================================================================

test("NICKNAME UTILS: prefix format, length limit, and Unicode safety", () => {
  assert.equal(NICKNAME_PREFIX, "LOA | ");
  assert.equal(MAX_NICKNAME_LENGTH, 32);

  // Normal name formatting
  assert.equal(formatLoaNickname("Damon"), "LOA | Damon");

  // Idempotency: never double-prefix
  assert.equal(formatLoaNickname("LOA | Damon"), "LOA | Damon");
  assert.equal(hasLoaPrefix("LOA | Damon"), true);
  assert.equal(hasLoaPrefix("Damon"), false);

  // Strip prefix
  assert.equal(stripLoaPrefix("LOA | Damon"), "Damon");
  assert.equal(stripLoaPrefix("Damon"), "Damon");

  // Length limit enforcement: 32 chars max
  const longName = "A".repeat(30);
  const formattedLong = formatLoaNickname(longName);
  assert.equal(formattedLong.length, 32);
  assert.equal(formattedLong, "LOA | " + "A".repeat(26));

  // Unicode grapheme safety: emojis should never be split in half
  const emojiName = "👨‍👩‍👧‍👦" + "SuperLongNicknameThatExceedsLimit";
  const formattedEmoji = formatLoaNickname(emojiName);
  assert.ok(formattedEmoji.startsWith("LOA | 👨‍👩‍👧‍👦"));
  assert.ok(formattedEmoji.length <= 32);
});

test("NICKNAME RESTORATION: computeRestoredNickname handles matching, manual changes, and nulls", () => {
  // Case 1: Nickname matches what Damo Bot set -> restores original nickname
  assert.equal(
    computeRestoredNickname({
      currentNickname: "LOA | Damon",
      originalNickname: "Damon",
      loaNickname: "LOA | Damon",
    }),
    "Damon"
  );

  // Case 2: Original nickname was null (no server nickname override) -> restores null
  assert.equal(
    computeRestoredNickname({
      currentNickname: "LOA | Damon",
      originalNickname: null,
      loaNickname: "LOA | Damon",
    }),
    null
  );

  // Case 3: Manual nickname change during LOA still having "LOA | " prefix -> strips ONLY prefix
  assert.equal(
    computeRestoredNickname({
      currentNickname: "LOA | Big Damon",
      originalNickname: "Damon",
      loaNickname: "LOA | Damon",
    }),
    "Big Damon"
  );

  // Case 4: Nickname was manually changed without prefix -> leaves current nickname untouched
  assert.equal(
    computeRestoredNickname({
      currentNickname: "Big Damon",
      originalNickname: "Damon",
      loaNickname: "LOA | Damon",
    }),
    "Big Damon"
  );
});

test("ACTIVE LOA START TODAY: immediately applies 'LOA | ' prefix via Discord REST API", async () => {
  const originalFetch = globalThis.fetch;
  let patchMemberCalled = false;
  let patchedNick = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/staff_nick_1") && options.method === "PATCH") {
      patchMemberCalled = true;
      const body = JSON.parse(options.body || "{}");
      if (body.nick !== undefined) {
        patchedNick = body.nick;
      }
      return new Response(JSON.stringify({ nick: patchedNick }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_pub_1" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const pubHex = Buffer.from(rawPub).toString("hex");

    const guildMap = new Map();
    const env = createMockEnvironment(pubHex, guildMap);
    const doEntry = createMockLoaDO(env);
    guildMap.set("guild_vital", doEntry);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const today = getTodayInChicago(); // Start today!
    const [year, month, day] = today.split("-").map(Number);
    const endIso = `${year}-${String(month).padStart(2, "0")}-${String(day + 3).padStart(2, "0")}`;

    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_nick_1", username: "Damon" },
        nick: "Damon",
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [
          {
            name: "start",
            options: [
              { name: "start_date", value: `${month}/${day}/${year}` },
              { name: "end_date", value: `${month}/${day + 3}/${year}` },
              { name: "reason", value: "Quick getaway" },
            ],
          },
        ],
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
    assert.equal(patchMemberCalled, true);
    assert.equal(patchedNick, "LOA | Damon");

    // Verify record in DO
    const created = [...doEntry.mockStorage.records.values()][0];
    assert.ok(created);
    assert.equal(created.original_nickname, "Damon");
    assert.equal(created.loa_nickname, "LOA | Damon");
    assert.equal(created.nickname_modified, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("UPCOMING LOA START: does NOT change nickname immediately", async () => {
  const originalFetch = globalThis.fetch;
  let patchMemberCalled = false;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/") && options.method === "PATCH") {
      patchMemberCalled = true;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_pub_upcoming" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const pubHex = Buffer.from(rawPub).toString("hex");

    const guildMap = new Map();
    const env = createMockEnvironment(pubHex, guildMap);
    const doEntry = createMockLoaDO(env);
    guildMap.set("guild_vital", doEntry);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const today = getTodayInChicago();
    const [year, month, day] = today.split("-").map(Number);

    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_upcoming_1", username: "StaffUpcoming" },
        nick: "StaffUpcoming",
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [
          {
            name: "start",
            options: [
              { name: "start_date", value: `${month}/${day + 5}/${year}` },
              { name: "end_date", value: `${month}/${day + 10}/${year}` },
              { name: "reason", value: "Upcoming conference" },
            ],
          },
        ],
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
    assert.equal(patchMemberCalled, false); // Must NOT patch nickname yet!

    const created = [...doEntry.mockStorage.records.values()][0];
    assert.ok(created);
    assert.equal(created.original_nickname, "StaffUpcoming");
    assert.equal(created.loa_nickname, null);
    assert.equal(created.nickname_modified, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CRON ROLLOVER: upcoming LOA becoming active applies 'LOA | ' prefix", async () => {
  const originalFetch = globalThis.fetch;
  let patchCalled = false;
  let newNickApplied = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/user_rollover_1") && options.method === "GET") {
      return new Response(JSON.stringify({ nick: "RolloverUser" }), { status: 200 });
    }
    if (urlStr.includes("/members/user_rollover_1") && options.method === "PATCH") {
      patchCalled = true;
      const b = JSON.parse(options.body);
      newNickApplied = b.nick;
      return new Response(JSON.stringify({ nick: newNickApplied }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      return new Response(JSON.stringify({ id: "msg_rollover_refreshed" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const env = {
      DISCORD_BOT_TOKEN: "mock_token",
      LOA_CHANNEL_ID: TEST_LOA_CHANNEL_ID,
    };
    const doEntry = createMockLoaDO(env);

    // Prepopulate an upcoming LOA that starts on 2026-09-10
    const loaId = "loa_rollover_1";
    doEntry.mockStorage.records.set(loaId, {
      id: loaId,
      guild_id: "guild_vital",
      user_id: "user_rollover_1",
      display_name: "RolloverUser",
      start_date: "2026-09-10",
      end_date: "2026-09-15",
      reason: "Vacation",
      cancelled: 0,
      ended_early: 0,
      ended_at: null,
      original_nickname: "RolloverUser",
      loa_nickname: null,
      nickname_modified: 0,
    });

    // Run cron with todayIso = "2026-09-10" (it just became active!)
    const cronRes = await doEntry.instance.processCronRollover({
      env,
      todayIso: "2026-09-10",
    });

    assert.equal(cronRes.success, true);
    assert.equal(cronRes.activatedCount, 1);
    assert.equal(patchCalled, true);
    assert.equal(newNickApplied, "LOA | RolloverUser");

    const record = doEntry.mockStorage.records.get(loaId);
    assert.equal(record.nickname_modified, 1);
    assert.equal(record.loa_nickname, "LOA | RolloverUser");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CRON ROLLOVER: completed LOA removes prefix and restores original nickname", async () => {
  const originalFetch = globalThis.fetch;
  let patchCalled = false;
  let restoredNick = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/user_done_1") && options.method === "GET") {
      return new Response(JSON.stringify({ nick: "LOA | OriginalUser" }), { status: 200 });
    }
    if (urlStr.includes("/members/user_done_1") && options.method === "PATCH") {
      patchCalled = true;
      const b = JSON.parse(options.body);
      restoredNick = b.nick;
      return new Response(JSON.stringify({ nick: restoredNick }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      return new Response(JSON.stringify({ id: "msg_done_refreshed" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const env = {
      DISCORD_BOT_TOKEN: "mock_token",
      LOA_CHANNEL_ID: TEST_LOA_CHANNEL_ID,
    };
    const doEntry = createMockLoaDO(env);

    // Prepopulate an active LOA ending on 2026-09-05
    const loaId = "loa_done_1";
    doEntry.mockStorage.records.set(loaId, {
      id: loaId,
      guild_id: "guild_vital",
      user_id: "user_done_1",
      display_name: "OriginalUser",
      start_date: "2026-09-01",
      end_date: "2026-09-05",
      reason: "Vacation",
      cancelled: 0,
      ended_early: 0,
      ended_at: null,
      original_nickname: "OriginalUser",
      loa_nickname: "LOA | OriginalUser",
      nickname_modified: 1,
    });

    // Run cron on 2026-09-06 (the LOA has now completed)
    const cronRes = await doEntry.instance.processCronRollover({
      env,
      todayIso: "2026-09-06",
    });

    assert.equal(cronRes.success, true);
    assert.equal(cronRes.restoredCount, 1);
    assert.equal(patchCalled, true);
    assert.equal(restoredNick, "OriginalUser");

    const record = doEntry.mockStorage.records.get(loaId);
    assert.equal(record.nickname_modified, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CRON ROLLOVER: completed LOA with original NULL nickname restores to NULL", async () => {
  const originalFetch = globalThis.fetch;
  let patchCalled = false;
  let restoredNick = "not_null";

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/user_null_1") && options.method === "GET") {
      return new Response(JSON.stringify({ nick: "LOA | StandardUsername" }), { status: 200 });
    }
    if (urlStr.includes("/members/user_null_1") && options.method === "PATCH") {
      patchCalled = true;
      const b = JSON.parse(options.body);
      restoredNick = b.nick;
      return new Response(JSON.stringify({ nick: null }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      return new Response(JSON.stringify({ id: "msg_null_refreshed" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const env = {
      DISCORD_BOT_TOKEN: "mock_token",
      LOA_CHANNEL_ID: TEST_LOA_CHANNEL_ID,
    };
    const doEntry = createMockLoaDO(env);

    const loaId = "loa_null_1";
    doEntry.mockStorage.records.set(loaId, {
      id: loaId,
      guild_id: "guild_vital",
      user_id: "user_null_1",
      display_name: "StandardUsername",
      start_date: "2026-09-01",
      end_date: "2026-09-05",
      reason: "Personal",
      cancelled: 0,
      ended_early: 0,
      ended_at: null,
      original_nickname: null, // User had no server nickname originally!
      loa_nickname: "LOA | StandardUsername",
      nickname_modified: 1,
    });

    await doEntry.instance.processCronRollover({
      env,
      todayIso: "2026-09-06",
    });

    assert.equal(patchCalled, true);
    assert.equal(restoredNick, null); // Restores null to clear server nickname override!
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CRON ROLLOVER: manual nickname change during LOA preserves manual change upon completion", async () => {
  const originalFetch = globalThis.fetch;
  let patchCalled = false;
  let restoredNick = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    // User was manually renamed to "LOA | Big Damon" while away
    if (urlStr.includes("/members/user_manual_1") && options.method === "GET") {
      return new Response(JSON.stringify({ nick: "LOA | Big Damon" }), { status: 200 });
    }
    if (urlStr.includes("/members/user_manual_1") && options.method === "PATCH") {
      patchCalled = true;
      const b = JSON.parse(options.body);
      restoredNick = b.nick;
      return new Response(JSON.stringify({ nick: restoredNick }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      return new Response(JSON.stringify({ id: "msg_manual_refreshed" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const env = {
      DISCORD_BOT_TOKEN: "mock_token",
      LOA_CHANNEL_ID: TEST_LOA_CHANNEL_ID,
    };
    const doEntry = createMockLoaDO(env);

    const loaId = "loa_manual_1";
    doEntry.mockStorage.records.set(loaId, {
      id: loaId,
      guild_id: "guild_vital",
      user_id: "user_manual_1",
      display_name: "Damon",
      start_date: "2026-09-01",
      end_date: "2026-09-05",
      reason: "Vacation",
      cancelled: 0,
      ended_early: 0,
      ended_at: null,
      original_nickname: "Damon",
      loa_nickname: "LOA | Damon",
      nickname_modified: 1,
    });

    await doEntry.instance.processCronRollover({
      env,
      todayIso: "2026-09-06",
    });

    assert.equal(patchCalled, true);
    // Preserves "Big Damon" without overwriting it back to stale "Damon"
    assert.equal(restoredNick, "Big Damon");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RETURN EARLY: removes prefix immediately and restores nickname", async () => {
  const originalFetch = globalThis.fetch;
  let patchCalled = false;
  let restoredNick = null;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/staff_return_early") && options.method === "GET") {
      return new Response(JSON.stringify({ nick: "LOA | EarlyBird" }), { status: 200 });
    }
    if (urlStr.includes("/members/staff_return_early") && options.method === "PATCH") {
      patchCalled = true;
      const b = JSON.parse(options.body);
      restoredNick = b.nick;
      return new Response(JSON.stringify({ nick: restoredNick }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      return new Response(JSON.stringify({ id: "msg_return_pub" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const pubHex = Buffer.from(rawPub).toString("hex");

    const guildMap = new Map();
    const env = createMockEnvironment(pubHex, guildMap);
    const doEntry = createMockLoaDO(env);
    guildMap.set("guild_vital", doEntry);

    const today = getTodayInChicago();
    const loaId = "loa_early_return_active";
    doEntry.mockStorage.records.set(loaId, {
      id: loaId,
      guild_id: "guild_vital",
      user_id: "staff_return_early",
      display_name: "EarlyBird",
      start_date: today,
      end_date: "2026-09-30",
      reason: "Early break",
      cancelled: 0,
      ended_early: 0,
      ended_at: null,
      original_nickname: "EarlyBird",
      loa_nickname: "LOA | EarlyBird",
      nickname_modified: 1,
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_return_early" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        custom_id: `${LoaCustomId.CONFIRM_RETURN_PREFIX}${loaId}`,
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
    assert.equal(patchCalled, true);
    assert.equal(restoredNick, "EarlyBird");

    const rec = doEntry.mockStorage.records.get(loaId);
    assert.equal(rec.ended_early, 1);
    assert.equal(rec.nickname_modified, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("UPCOMING CANCELLATION: does not attempt to modify Discord nickname", async () => {
  const originalFetch = globalThis.fetch;
  let patchCalled = false;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/") && options.method === "PATCH") {
      patchCalled = true;
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      return new Response(JSON.stringify({ id: "msg_cancel_pub" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const pubHex = Buffer.from(rawPub).toString("hex");

    const guildMap = new Map();
    const env = createMockEnvironment(pubHex, guildMap);
    const doEntry = createMockLoaDO(env);
    guildMap.set("guild_vital", doEntry);

    const loaId = "loa_upcoming_cancel";
    doEntry.mockStorage.records.set(loaId, {
      id: loaId,
      guild_id: "guild_vital",
      user_id: "staff_cancel_up",
      display_name: "StaffCancel",
      start_date: "2026-10-01",
      end_date: "2026-10-10",
      reason: "Future break",
      cancelled: 0,
      ended_early: 0,
      ended_at: null,
      original_nickname: "StaffCancel",
      loa_nickname: null,
      nickname_modified: 0,
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_cancel_up" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        custom_id: `${LoaCustomId.CONFIRM_CANCEL_PREFIX}${loaId}`,
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
    assert.equal(patchCalled, false); // Prefix was never added, so never modified!
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DISCORD 403 (MISSING PERMISSIONS / ROLE HIERARCHY): does NOT fail LOA creation", async () => {
  const originalFetch = globalThis.fetch;
  let patchAttempted = false;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/staff_hierarchy") && options.method === "PATCH") {
      const body = JSON.parse(options.body || "{}");
      if (body.nick !== undefined) {
        patchAttempted = true;
        // Return 403 Forbidden (e.g. role hierarchy or missing Manage Nicknames)
        return new Response(
          JSON.stringify({ code: 50013, message: "Missing Permissions" }),
          { status: 403 }
        );
      }
      return new Response(JSON.stringify({ roles: body.roles || [] }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_pub_hierarchy" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const pubHex = Buffer.from(rawPub).toString("hex");

    const guildMap = new Map();
    const env = createMockEnvironment(pubHex, guildMap);
    const doEntry = createMockLoaDO(env);
    guildMap.set("guild_vital", doEntry);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const today = getTodayInChicago();
    const [year, month, day] = today.split("-").map(Number);

    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_hierarchy", username: "HierarchyAdmin" },
        nick: "HierarchyAdmin",
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [
          {
            name: "start",
            options: [
              { name: "start_date", value: `${month}/${day}/${year}` },
              { name: "end_date", value: `${month}/${day + 2}/${year}` },
              { name: "reason", value: "Admin break" },
            ],
          },
        ],
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
    assert.equal(patchAttempted, true);

    const json = await res.json();
    // LOA creation SUCCEEDED!
    const containerText = JSON.stringify(json.data.components);
    assert.ok(containerText.includes("Leave of Absence Submitted"));
    assert.ok(containerText.includes("Damo Bot could not update your nickname"));

    // Record exists in DO with nickname_modified = 0
    const created = [...doEntry.mockStorage.records.values()][0];
    assert.ok(created);
    assert.equal(created.nickname_modified, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DASHBOARD DISPLAY: cards strip 'LOA | ' and 'LOA || ' prefix so display shows clean bold name without headings", () => {
  const loas = [
    {
      id: "loa_dash_1",
      display_name: "LOA | Damon",
      start_date: "2026-09-01",
      end_date: "2026-09-10",
      reason: "Holiday",
    },
    {
      id: "loa_dash_2",
      display_name: "LOA || clementine !!",
      start_date: "2026-09-01",
      end_date: "2026-09-15",
      reason: "Moving",
    },
    {
      id: "loa_dash_3",
      display_name: "Jonsey LOA",
      start_date: "2026-09-01",
      end_date: "2026-09-08",
      reason: "Burnout",
    },
  ];

  const containers = buildLoaListContainers(loas);
  const jsonStr = JSON.stringify(containers);

  // Must display clean bold name without markdown headings (no ###)
  assert.ok(jsonStr.includes("🟢 **Damon**"));
  assert.ok(!jsonStr.includes("LOA | Damon"));

  assert.ok(jsonStr.includes("🟢 **clementine !!**"));
  assert.ok(!jsonStr.includes("LOA || clementine !!"));

  // Does not strip "LOA" if it appears naturally elsewhere in a name
  assert.ok(jsonStr.includes("🟢 **Jonsey LOA**"));
  assert.ok(!jsonStr.includes("### 🟢"));
});

test("CRON ARCHITECTURE: reuses single existing cron trigger for sticky and LOA", async () => {
  let stickyPollCalled = false;
  let loaCronCalled = false;

  const env = {
    DISCORD_GUILD_ID: "guild_vital",
    STICKY_BOT: {
      idFromName: () => "global",
      get: () => ({
        fetch: async (url) => {
          if (String(url).includes("/sticky/poll")) {
            stickyPollCalled = true;
            return new Response(JSON.stringify({ success: true }));
          }
        },
      }),
    },
    STAFF_LOA: {
      idFromName: () => "guild_vital",
      get: () => ({
        fetch: async (url) => {
          if (String(url).includes("/loa/cron")) {
            loaCronCalled = true;
            return new Response(JSON.stringify({ success: true }));
          }
        },
      }),
    },
  };

  await worker.scheduled({}, env, {});
  assert.equal(stickyPollCalled, true);
  assert.equal(loaCronCalled, true);
});

// =============================================================================
// VERSIONING & VITAL RP BRAND FOOTER TESTS
// =============================================================================

test("VERSION & BRANDING: canonical single source of truth in src/config.js", () => {
  assert.match(DAMO_BOT_VERSION, /^v\d+\.\d+\.\d+(-beta(\.\d+)?)?$/);
  assert.equal(
    VITAL_RP_LOGO_URL,
    "https://r2.fivemanage.com/image/qlWrCeXTQdqx.png"
  );
});

test("FOOTER BUILDER: creates Components V2 text-only Text Display with centralized version", () => {
  const footer = buildDamoFooter({
    productName: "Staff LOA Manager",
    timestamp: 1725321600,
  });

  // Must be a real Discord Text Display component (Type 10)
  assert.equal(footer.type, ComponentType.TEXT_DISPLAY);
  assert.ok(footer.content.includes("-# 🤖 Damo Bot • Staff LOA Manager"));
  assert.ok(footer.content.includes(`-# ${DAMO_BOT_VERSION} • Updated <t:1725321600:R>`));
  assert.equal(footer.accessory, undefined, "Footer must be text-only without any accessory");

  // Verify custom product name and personality line support
  const customFooter = buildDamoFooter({
    productName: "Referral Manager",
    personalityLine: "Keeping track because apparently somebody has to.",
  });
  assert.equal(customFooter.type, ComponentType.TEXT_DISPLAY);
  assert.ok(customFooter.content.includes("-# 🤖 Damo Bot • Referral Manager"));
  assert.ok(
    customFooter.content.includes(
      `-# ${DAMO_BOT_VERSION} • Keeping track because apparently somebody has to.`
    )
  );
  assert.equal(customFooter.accessory, undefined);
});

test("LOA DASHBOARD: displays Vital RP logo in header Section and centralized version in text-only footer", () => {
  // 1. Empty list state
  const emptyContainers = buildLoaListContainers([]);
  const emptyContainer = emptyContainers[0];

  // Header section with Vital RP Thumbnail accessory
  const headerSection = emptyContainer.components.find(
    (c) => c.type === ComponentType.SECTION
  );
  assert.ok(headerSection, "Empty list must contain a header Section");
  assert.equal(headerSection.accessory?.type, ComponentType.THUMBNAIL);
  assert.equal(headerSection.accessory?.media?.url, VITAL_RP_LOGO_URL);

  // Footer is text-only Text Display with centralized version
  const textDisplays = emptyContainer.components.filter(
    (c) => c.type === ComponentType.TEXT_DISPLAY
  );
  const footerTextComp = textDisplays[textDisplays.length - 1];
  assert.ok(footerTextComp, "Empty list must have a footer Text Display");
  assert.ok(
    footerTextComp.content.includes(DAMO_BOT_VERSION),
    "Empty list footer must display current version"
  );
  assert.ok(
    footerTextComp.content.includes("Suspicious levels of staff availability detected.")
  );

  // 2. Populated list state
  const sampleLoas = [
    {
      display_name: "Damon",
      start_date: "2026-09-02",
      end_date: "2026-09-10",
      reason: "Vacation",
    },
  ];
  const populatedContainers = buildLoaListContainers(sampleLoas);
  const popContainer = populatedContainers[0];

  const popHeaderSection = popContainer.components.find(
    (c) => c.type === ComponentType.SECTION
  );
  assert.ok(popHeaderSection, "Populated list must contain a header Section");
  assert.equal(popHeaderSection.accessory?.type, ComponentType.THUMBNAIL);
  assert.equal(popHeaderSection.accessory?.media?.url, VITAL_RP_LOGO_URL);

  const popTexts = popContainer.components.filter(
    (c) => c.type === ComponentType.TEXT_DISPLAY
  );
  const popFooterText = popTexts[popTexts.length - 1];
  assert.ok(
    popFooterText.content.includes(DAMO_BOT_VERSION),
    "Populated list footer must display current version"
  );
});

test("MY LOA PANEL: displays centralized version in footer and contextual action buttons", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);
  const doEntry = createMockLoaDO(env);
  guildMap.set("guild_vital", doEntry);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.APPLICATION_COMMAND,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_status_v" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: {
      name: "loa",
      options: [{ name: "status" }],
    },
  });
  const sig = await signDiscordPayload(body, keyPair, timestamp);

  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  const json = await res.json();
  const container = json.data.components[0];
  const allTexts = getContainerTexts(container);

  assert.ok(allTexts.includes(DAMO_BOT_VERSION), "My LOA panel must include centralized version");

  // If no LOA, contains [ Start LOA ] button
  const actionRow = container.components.find((c) => c.type === ComponentType.ACTION_ROW);
  assert.ok(actionRow);
  assert.equal(actionRow.components[0].custom_id, LoaCustomId.BTN_START);
});

test("CONFIRMATIONS: started, updated, cancelled, and returned early display centralized version in text footer", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/")) {
      return new Response(JSON.stringify({ nick: "User" }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      return new Response(JSON.stringify({ id: "msg_conf_pub" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const pubHex = Buffer.from(rawPub).toString("hex");

    const guildMap = new Map();
    const env = createMockEnvironment(pubHex, guildMap);
    const doEntry = createMockLoaDO(env);
    guildMap.set("guild_vital", doEntry);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const today = getTodayInChicago();
    const [year, month, day] = today.split("-").map(Number);

    // 1. Start confirmation
    const bodyStart = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_conf_v", username: "ConfUser" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [
          {
            name: "start",
            options: [
              { name: "start_date", value: `${month}/${day}/${year}` },
              { name: "end_date", value: `${month}/${day + 5}/${year}` },
              { name: "reason", value: "Break" },
            ],
          },
        ],
      },
    });

    const sigStart = await signDiscordPayload(bodyStart, keyPair, timestamp);
    const resStart = await worker.fetch(
      new Request("https://damo-bot.local/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": sigStart,
          "x-signature-timestamp": timestamp,
        },
        body: bodyStart,
      }),
      env,
      {}
    );

    const jsonStart = await resStart.json();
    const textStart = getContainerTexts(jsonStart.data.components[0]);
    assert.ok(textStart.includes(DAMO_BOT_VERSION), "Start confirmation must have version");

    // 2. Edit confirmation
    const bodyEdit = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_conf_v" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [
          {
            name: "edit",
            options: [
              { name: "reason", value: "Extended break" },
            ],
          },
        ],
      },
    });

    const sigEdit = await signDiscordPayload(bodyEdit, keyPair, timestamp);
    const resEdit = await worker.fetch(
      new Request("https://damo-bot.local/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": sigEdit,
          "x-signature-timestamp": timestamp,
        },
        body: bodyEdit,
      }),
      env,
      {}
    );

    const jsonEdit = await resEdit.json();
    const textEdit = getContainerTexts(jsonEdit.data.components[0]);
    assert.ok(textEdit.includes(DAMO_BOT_VERSION), "Edit confirmation must have version");

    // 3. Return Early confirmation
    const bodyReturn = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_conf_v" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [{ name: "cancel" }],
      },
    });

    const sigReturn = await signDiscordPayload(bodyReturn, keyPair, timestamp);
    const resReturn = await worker.fetch(
      new Request("https://damo-bot.local/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": sigReturn,
          "x-signature-timestamp": timestamp,
        },
        body: bodyReturn,
      }),
      env,
      {}
    );

    const jsonReturn = await resReturn.json();
    const textReturn = getContainerTexts(jsonReturn.data.components[0]);
    assert.ok(textReturn.includes(DAMO_BOT_VERSION), "Return confirmation must have version");
    assert.ok(textReturn.includes("Welcome back, I guess."));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("VERSION BUMP: bumpVersionString correctly increments patch, minor, and major versions", () => {
  assert.equal(bumpVersionString("v0.8.0-beta"), "v0.8.1-beta");
  assert.equal(bumpVersionString("v0.8.1-beta"), "v0.8.2-beta");
  assert.equal(bumpVersionString("v0.8.0-beta.1"), "v0.8.0-beta.2");
  assert.equal(bumpVersionString("v0.8.0"), "v0.8.1");
  assert.equal(bumpVersionString("v0.8.0-beta", "minor"), "v0.9.0-beta");
  assert.equal(bumpVersionString("v0.8.0-beta", "major"), "v1.0.0-beta");
  assert.equal(bumpVersionString("v0.8.0", "v0.9.0"), "v0.9.0");
});

test("COMMAND REGISTRATION SCHEMA: /loa ONLY exposes list subcommand", () => {
  const loaCmd = commands.find((c) => c.name === "loa");
  assert.ok(loaCmd, "/loa command definition must exist in registration commands array");
  assert.equal(loaCmd.description, "Manage Staff Leave of Absence (LOA)");
  assert.equal(loaCmd.options?.length, 1, "/loa must only have 1 subcommand (list)");

  const listSub = loaCmd.options[0];
  assert.equal(listSub.name, "list");
  assert.equal(listSub.description, "Open or refresh the Staff LOA Center.");
  assert.equal(listSub.type, 1); // SUB_COMMAND

  // Obsolete subcommands must NOT be registered
  const optionNames = loaCmd.options.map((o) => o.name);
  assert.ok(!optionNames.includes("start"), "/loa start must NOT be registered");
  assert.ok(!optionNames.includes("edit"), "/loa edit must NOT be registered");
  assert.ok(!optionNames.includes("cancel"), "/loa cancel must NOT be registered");
  assert.ok(!optionNames.includes("status"), "/loa status must NOT be registered");
  assert.ok(!optionNames.includes("dashboard"), "/loa dashboard must NOT be registered");
});

test("RETURN ALERTS: StaffLoaDO subscription tracking, toggle, and notifySubscribers", async () => {
  const env = createMockEnvironment();
  const doEntry = createMockLoaDO(env);
  const doInstance = doEntry.instance;

  doInstance.createLoa({
    id: "loa_alert_1",
    guildId: "guild_vital",
    userId: "staff_vacationer",
    displayName: "Vacationer",
    startDate: "2026-09-02",
    endDate: "2026-09-08",
    reason: "Trip",
    todayIso: "2026-09-02",
  });

  // 1. Initially no subscriptions
  assert.deepEqual(doInstance.getSubscribersForLoa("loa_alert_1"), []);
  assert.deepEqual(doInstance.getUserSubscriptions("staff_watcher"), []);

  // 2. Toggle on (Subscribe)
  const subRes = doInstance.toggleSubscription({
    loaId: "loa_alert_1",
    userId: "staff_watcher",
    guildId: "guild_vital",
  });
  assert.equal(subRes.success, true);
  assert.equal(subRes.subscribed, true);
  assert.deepEqual(doInstance.getSubscribersForLoa("loa_alert_1"), ["staff_watcher"]);
  assert.deepEqual(doInstance.getUserSubscriptions("staff_watcher"), ["loa_alert_1"]);

  // 3. Toggle off (Unsubscribe)
  const unsubRes = doInstance.toggleSubscription({
    loaId: "loa_alert_1",
    userId: "staff_watcher",
    guildId: "guild_vital",
  });
  assert.equal(unsubRes.success, true);
  assert.equal(unsubRes.subscribed, false);
  assert.deepEqual(doInstance.getSubscribersForLoa("loa_alert_1"), []);

  // 4. Subscribe again and verify notification on early return
  doInstance.toggleSubscription({
    loaId: "loa_alert_1",
    userId: "staff_watcher",
    guildId: "guild_vital",
  });

  const sentNotifications = [];
  const mockFetch = async (url, options = {}) => {
    if (String(url).includes("/channels/") && options.method === "POST") {
      sentNotifications.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "msg_notif_1" }), { status: 200 });
    }
    return new Response("OK", { status: 200 });
  };

  await doInstance.notifySubscribers({
    loa: { id: "loa_alert_1", display_name: "Vacationer" },
    reasonText: "returned from LOA early",
    env: { DISCORD_BOT_TOKEN: "mock_token", LOA_CHANNEL_ID: "mock_chan" },
    customFetch: mockFetch,
  });

  assert.equal(sentNotifications.length, 1);
  assert.ok(sentNotifications[0].content.includes("<@staff_watcher>"));
  assert.ok(sentNotifications[0].content.includes("Vacationer"));
  assert.ok(sentNotifications[0].content.includes("returned from LOA early"));
  assert.deepEqual(sentNotifications[0].allowed_mentions.users, ["staff_watcher"]);

  // Idempotent delivery: Subscriptions cleared after delivery
  assert.deepEqual(doInstance.getSubscribersForLoa("loa_alert_1"), []);
});

test("RETURN ALERTS: [ 🔔 Return Alerts ] interaction renders panel and toggles subscriptions", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);
  const doEntry = createMockLoaDO(env);
  guildMap.set("guild_vital", doEntry);

  doEntry.instance.createLoa({
    id: "loa_active_test",
    guildId: "guild_vital",
    userId: "staff_on_leave",
    displayName: "OnLeave",
    startDate: "2026-09-02",
    endDate: "2026-09-18",
    reason: "Rest",
    todayIso: "2026-09-02",
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();

  // 1. Click [ 🔔 Return Alerts ]
  const bodyAlerts = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_subscriber" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: { custom_id: LoaCustomId.BTN_ALERTS },
  });
  const sigAlerts = await signDiscordPayload(bodyAlerts, keyPair, timestamp);

  const resAlerts = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sigAlerts,
        "x-signature-timestamp": timestamp,
      },
      body: bodyAlerts,
    }),
    env,
    {}
  );

  const jsonAlerts = await resAlerts.json();
  const alertContainer = jsonAlerts.data.components[0];
  const alertText = getContainerTexts(alertContainer);
  assert.ok(alertText.includes("# 🔔 Return Alerts"));
  assert.ok(alertText.includes("OnLeave"));

  // Check toggle button
  const toggleBtn = alertContainer.components
    .flatMap((c) => (c.type === ComponentType.ACTION_ROW ? c.components : []))
    .find((b) => b.custom_id === `${LoaCustomId.ALERT_TOGGLE_PREFIX}loa_active_test`);
  assert.ok(toggleBtn);
  assert.equal(toggleBtn.label, "Get Alerts for OnLeave");

  // 2. Click toggle button to subscribe
  const bodyToggle = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_subscriber" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: { custom_id: `${LoaCustomId.ALERT_TOGGLE_PREFIX}loa_active_test` },
  });
  const sigToggle = await signDiscordPayload(bodyToggle, keyPair, timestamp);

  const resToggle = await worker.fetch(
    new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sigToggle,
        "x-signature-timestamp": timestamp,
      },
      body: bodyToggle,
    }),
    env,
    {}
  );

  const jsonToggle = await resToggle.json();
  const toggledContainer = jsonToggle.data.components[0];
  const updatedBtn = toggledContainer.components
    .flatMap((c) => (c.type === ComponentType.ACTION_ROW ? c.components : []))
    .find((b) => b.custom_id === `${LoaCustomId.ALERT_TOGGLE_PREFIX}loa_active_test`);

  assert.ok(updatedBtn);
  assert.equal(updatedBtn.label, "Stop Alerts for OnLeave");
  assert.deepEqual(doEntry.instance.getSubscribersForLoa("loa_active_test"), ["staff_subscriber"]);
});

test("PERMANENT DASHBOARD: updates via PATCH if existing, recovers via POST if deleted (404)", async () => {
  const env = {
    DISCORD_BOT_TOKEN: "mock_token",
    LOA_CHANNEL_ID: "mock_chan",
    STAFF_LOA: {
      idFromName: () => "mock_do_id",
      get: () => ({
        fetch: async (url, opts = {}) => {
          const urlStr = String(url);
          if (urlStr.includes("/loa/list")) {
            return new Response(JSON.stringify({ loas: [] }));
          }
          if (urlStr.includes("/loa/meta") && opts.method === "POST") {
            const b = JSON.parse(opts.body);
            if (b.lastListMessageId) metaStore.lastListMessageId = b.lastListMessageId;
            return new Response(JSON.stringify({ success: true }));
          }
          if (urlStr.includes("/loa/meta")) {
            return new Response(JSON.stringify(metaStore));
          }
          return new Response("OK");
        },
      }),
    },
  };

  const metaStore = { lastListMessageId: "msg_existing_404" };
  const requests = [];

  const customFetch = async (url, options = {}) => {
    requests.push({ method: options.method, url: String(url) });
    // Simulate 404 on PATCH (e.g. user manually deleted the old message in Discord)
    if (options.method === "PATCH") {
      return new Response("Not Found", { status: 404 });
    }
    // Fallback POST creates replacement permanent message
    if (options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_replacement_999" }), { status: 200 });
    }
    return new Response("OK");
  };

  const result = await refreshPublicLoaList({
    env,
    guildId: "guild_vital",
    todayIso: "2026-09-02",
    customFetch,
  });

  assert.equal(result.success, true);
  assert.equal(result.messageId, "msg_replacement_999");
  assert.equal(requests[0].method, "PATCH");
  assert.equal(requests[1].method, "POST");
  assert.equal(metaStore.lastListMessageId, "msg_replacement_999");
});

test("INDIVIDUAL STAFF ENTRY DESIGN: compact layout with bold name, bold dates, blockquote reason, and subtext return", () => {
  const sampleLoas = [
    {
      display_name: "LOA | Jonsey LOA",
      start_date: "2026-08-25",
      end_date: "2026-09-08",
      reason: "burnout",
      avatar_url: "https://example.com/avatar1.png",
    },
    {
      display_name: "LOA || MrCarlile",
      start_date: "2026-09-01",
      end_date: "2026-09-08",
      reason: "mental health break",
    },
    {
      display_name: "clementine !!",
      start_date: "2026-09-01",
      end_date: "2026-09-15",
      reason: "moving !! (may need to update end date)",
    },
  ];

  const containers = buildLoaListContainers(sampleLoas, null, "2026-09-02");
  assert.equal(containers.length, 1);
  const container = containers[0];

  // 1. Verify staff entry components and separators
  // Components layout: Header Section (index 0), ActionRow (index 1), Separator, Staff 1, Separator, Staff 2, Separator, Staff 3, Separator, Footer
  const comps = container.components;
  assert.equal(comps[0].type, ComponentType.SECTION); // Header Section
  assert.equal(comps[1].type, ComponentType.ACTION_ROW); // Control buttons

  assert.equal(comps[2].type, ComponentType.SEPARATOR); // Separator before Staff 1
  assert.equal(comps[3].type, ComponentType.SECTION); // Staff 1 (with avatar thumbnail)
  assert.equal(comps[3].accessory?.type, ComponentType.THUMBNAIL);
  assert.equal(comps[3].accessory?.media?.url, "https://example.com/avatar1.png");

  assert.equal(comps[4].type, ComponentType.SEPARATOR); // Separator between Staff 1 and Staff 2
  assert.equal(comps[5].type, ComponentType.TEXT_DISPLAY); // Staff 2 (no avatar)

  assert.equal(comps[6].type, ComponentType.SEPARATOR); // Separator between Staff 2 and Staff 3
  assert.equal(comps[7].type, ComponentType.TEXT_DISPLAY); // Staff 3 (no avatar)

  assert.equal(comps[8].type, ComponentType.SEPARATOR); // Separator before Footer
  assert.equal(comps[9].type, ComponentType.TEXT_DISPLAY); // Footer

  // 2. Verify text content of Staff 1
  const staff1Text = comps[3].components[0].content;
  const staff1Expected = [
    "🟢 **Jonsey LOA**",
    "**Aug 25 → Sep 8**",
    "> burnout",
    "-# ↩️ Returns Sep 8, 2026",
  ].join("\n");
  assert.equal(staff1Text, staff1Expected);

  // 3. Verify text content of Staff 2
  const staff2Text = comps[5].content;
  const staff2Expected = [
    "🟢 **MrCarlile**",
    "**Sep 1 → Sep 8**",
    "> mental health break",
    "-# ↩️ Returns Sep 8, 2026",
  ].join("\n");
  assert.equal(staff2Text, staff2Expected);

  // 4. Verify text content of Staff 3
  const staff3Text = comps[7].content;
  const staff3Expected = [
    "🟢 **clementine !!**",
    "**Sep 1 → Sep 15**",
    "> moving !! (may need to update end date)",
    "-# ↩️ Returns Sep 15, 2026",
  ].join("\n");
  assert.equal(staff3Text, staff3Expected);

  // 5. Verify NO Markdown headings (#, ##, ###) exist in staff entries
  for (const text of [staff1Text, staff2Text, staff3Text]) {
    assert.ok(!text.includes("###"));
    assert.ok(!text.includes("## "));
    assert.ok(!/(^|\n)#\s+/m.test(text), "Must not start any line with markdown heading #");
  }

  // 6. Verify NO repetitive labels exist
  for (const text of [staff1Text, staff2Text, staff3Text]) {
    assert.ok(!text.includes("Reason:"));
    assert.ok(!text.includes("Status:"));
    assert.ok(!text.includes("Dates:"));
    assert.ok(!text.includes("Staff Member:"));
    assert.ok(!text.includes("Scheduled Dates:"));
  }
});

test("DISPLAY SANITIZATION: strips leading LOA | and LOA || while preserving embedded LOA and leaving stored nickname untouched", () => {
  const originalNickname = "LOA || clementine !!";
  const sanitized = stripLoaPrefix(originalNickname);

  assert.equal(sanitized, "clementine !!");
  // Original string unmodified
  assert.equal(originalNickname, "LOA || clementine !!");

  // Single bar variant
  assert.equal(stripLoaPrefix("LOA | Damon"), "Damon");
  // Multi bar variant
  assert.equal(stripLoaPrefix("LOA ||| Bob"), "Bob");
  // No space variant
  assert.equal(stripLoaPrefix("LOA|Alice"), "Alice");
  // Preserves natural LOA in name
  assert.equal(stripLoaPrefix("Jonsey LOA"), "Jonsey LOA");
  assert.equal(stripLoaPrefix("LOA Team"), "LOA Team");
  assert.equal(stripLoaPrefix("Mr. LOA Smith"), "Mr. LOA Smith");
  // Empty / null handling
  assert.equal(stripLoaPrefix(null), "");
  assert.equal(stripLoaPrefix(""), "");
});

test("PAGINATION & LONG REASON SAFETY: handles 16+ staff and long reasons safely", () => {
  const loas = [];
  for (let i = 1; i <= 17; i++) {
    loas.push({
      display_name: `Staff Member ${i}`,
      start_date: "2026-09-01",
      end_date: "2026-09-08",
      reason: i === 1 ? "A".repeat(800) : `Reason ${i}`,
    });
  }

  const containers = buildLoaListContainers(loas, null, "2026-09-02");
  // 17 staff with chunk size 15 creates 2 pages / containers
  assert.equal(containers.length, 2);

  const page1 = containers[0];
  const page2 = containers[1];

  const page1Header = page1.components[0].components[0].content;
  assert.ok(page1Header.includes("Page 1 of 2"));

  const page2Header = page2.components[0].components[0].content;
  assert.ok(page2Header.includes("Page 2 of 2"));

  // Long reason on first staff member is safely clamped to <= 500 characters
  const firstStaffText = page1.components[3].content;
  assert.ok(firstStaffText.includes("🟢 **Staff Member 1**"));
  assert.ok(firstStaffText.length <= 600);
});

// ============================================================================
// REPOST ON LOA START (POST TO CHANNEL & DELETE OLD MESSAGE)
// ============================================================================

test("REPOST ON LOA START: Submitting start modal posts the LOA list again to the channel and deletes the previous message", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  // Seed the DO with an existing dashboard message ID
  const doEntry = createMockLoaDO();
  doEntry.instance.setMeta("last_list_message_id", "msg_old_dashboard_123");
  guildMap.set("guild_vital", doEntry);

  const postedMessages = [];
  const deletedMessages = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes(`/channels/${TEST_LOA_CHANNEL_ID}/messages`) && options.method === "POST") {
      const parsedBody = JSON.parse(options.body);
      const msgId = "msg_new_dashboard_456";
      postedMessages.push({ id: msgId, ...parsedBody });
      return new Response(JSON.stringify({ id: msgId }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && options.method === "DELETE") {
      const msgId = urlStr.split("/").pop();
      deletedMessages.push(msgId);
      return new Response(null, { status: 204 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MODAL_SUBMIT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "Sarah",
        user: { id: "staff_sarah", username: "sarah" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        custom_id: LoaCustomId.MODAL_START,
        components: [
          {
            type: 1,
            components: [{ custom_id: "start_date", value: "09/02/2026" }],
          },
          {
            type: 1,
            components: [{ custom_id: "end_date", value: "09/10/2026" }],
          },
          {
            type: 1,
            components: [{ custom_id: "reason", value: "Family vacation" }],
          },
        ],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);

    // 1. The LOA list was POSTed again as a new message
    assert.equal(postedMessages.length, 1);
    assert.equal(postedMessages[0].id, "msg_new_dashboard_456");

    // 2. The previous message was deleted
    assert.equal(deletedMessages.length, 1);
    assert.equal(deletedMessages[0], "msg_old_dashboard_123");

    // 3. DO metadata updated with new message ID
    assert.equal(doEntry.instance.getMeta("last_list_message_id"), "msg_new_dashboard_456");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("REPOST ON LOA START: refreshPublicLoaList with repost: true bypasses PATCH and posts new message", async () => {
  const metaStore = { lastListMessageId: "msg_prev_111" };
  const requests = [];

  const env = {
    DISCORD_BOT_TOKEN: "mock_token",
    LOA_CHANNEL_ID: "mock_chan",
    STAFF_LOA: {
      idFromName: () => "mock_do_id",
      get: () => ({
        fetch: async (url, opts = {}) => {
          const urlStr = String(url);
          if (urlStr.includes("/loa/list")) {
            return new Response(JSON.stringify({ loas: [] }));
          }
          if (urlStr.includes("/loa/meta") && opts.method === "POST") {
            const b = JSON.parse(opts.body);
            if (b.lastListMessageId) metaStore.lastListMessageId = b.lastListMessageId;
            return new Response(JSON.stringify({ success: true }));
          }
          if (urlStr.includes("/loa/meta")) {
            return new Response(JSON.stringify(metaStore));
          }
          return new Response("OK");
        },
      }),
    },
  };

  const customFetch = async (url, options = {}) => {
    requests.push({ method: options.method, url: String(url) });
    if (options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_new_222" }), { status: 200 });
    }
    if (options.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response("OK");
  };

  const result = await refreshPublicLoaList({
    env,
    guildId: "guild_vital",
    todayIso: "2026-09-02",
    customFetch,
    repost: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.messageId, "msg_new_222");

  // Verify requests: POST was called first, then DELETE for previous message (no PATCH)
  const postReq = requests.find((r) => r.method === "POST");
  const delReq = requests.find((r) => r.method === "DELETE");
  const patchReq = requests.find((r) => r.method === "PATCH");

  assert.ok(postReq, "POST request should be made");
  assert.ok(delReq, "DELETE request should be made for old message");
  assert.equal(patchReq, undefined, "PATCH should not be called when repost: true");
  assert.ok(delReq.url.endsWith("/msg_prev_111"), "Old message ID should be deleted");
  assert.equal(metaStore.lastListMessageId, "msg_new_222", "Metadata should store new message ID");
});

test("CRON ROLLOVER: Scheduled LOA activating today triggers repost of public list", async () => {
  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_scheduled_1",
    guildId: "guild_vital",
    userId: "staff_rollover",
    displayName: "RolloverStaff",
    startDate: "2026-09-03",
    endDate: "2026-09-10",
    reason: "Going away",
    todayIso: "2026-09-02",
  });
  doEntry.instance.setMeta("last_list_message_id", "msg_old_rollover_999");

  const postedMessages = [];
  const deletedMessages = [];

  const customFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      postedMessages.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: "msg_new_rollover_000" }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && options.method === "DELETE") {
      deletedMessages.push(urlStr.split("/").pop());
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ member: { nick: "RolloverStaff" } }), { status: 200 });
  };

  const env = {
    DISCORD_BOT_TOKEN: "mock_token",
    LOA_CHANNEL_ID: "mock_chan",
    STAFF_LOA: {
      idFromName: () => "guild_vital",
      get: () => ({
        fetch: (reqUrl, reqOpt) => doEntry.instance.fetch(new Request(reqUrl, reqOpt)),
      }),
    },
  };

  // Run rollover for 2026-09-03 (the scheduled start date)
  const result = await doEntry.instance.processCronRollover({
    env,
    todayIso: "2026-09-03",
    customFetch,
  });
  assert.equal(result.activatedCount, 1);

  // Verify that the LOA list was reposted and old message was deleted
  assert.equal(postedMessages.length, 1);
  assert.equal(deletedMessages.length, 1);
  assert.equal(deletedMessages[0], "msg_old_rollover_999");
  assert.equal(doEntry.instance.getMeta("last_list_message_id"), "msg_new_rollover_000");
});

test("UPCOMING LOAS: getActiveLoasList returns both active and upcoming staff, rendered correctly on dashboard", () => {
  const doEntry = createMockLoaDO();
  // 1 active LOA (starts Sep 1, ends Sep 8)
  doEntry.instance.createLoa({
    id: "loa_active_1",
    guildId: "guild_vital",
    userId: "staff_carlile",
    displayName: "MrCarlile",
    startDate: "2026-09-01",
    endDate: "2026-09-08",
    reason: "mental health break",
    todayIso: "2026-09-04",
  });
  // 1 upcoming LOA (starts Sep 5, ends Sep 12)
  doEntry.instance.createLoa({
    id: "loa_upcoming_1",
    guildId: "guild_vital",
    userId: "staff_damon",
    displayName: "damon",
    startDate: "2026-09-05",
    endDate: "2026-09-12",
    reason: "testing LOA",
    todayIso: "2026-09-04",
  });

  const loas = doEntry.instance.getActiveLoasList("2026-09-04");
  assert.equal(loas.length, 2, "Both active and upcoming LOAs should be returned in list");
  assert.equal(loas[0].display_name, "MrCarlile", "Active LOA should be ordered first");
  assert.equal(loas[1].display_name, "damon", "Upcoming LOA should be ordered second");

  const containers = buildLoaListContainers(loas, null, "2026-09-04");
  const jsonStr = JSON.stringify(containers);

  // Active staff has green circle and return date
  assert.ok(jsonStr.includes("🟢 **MrCarlile**"));
  assert.ok(jsonStr.includes("↩️ Returns Sep 8, 2026"));

  // Upcoming staff has yellow circle and start date
  assert.ok(jsonStr.includes("🟡 **damon**"));
  assert.ok(jsonStr.includes("🗓️ Starts Sep 5, 2026"));

  // Header displays active count and upcoming count
  assert.ok(jsonStr.includes("1 staff member is currently away • 1 upcoming"));
});

test("DATE PARSER: supports 'today' and 'now' keywords directly", () => {
  const parsedToday = parseAndValidateDate("today", "2026-09-04");
  assert.equal(parsedToday.valid, true);
  assert.equal(parsedToday.isoDate, "2026-09-04");
  assert.equal(parsedToday.displayDate, "09/04/2026");

  const parsedNow = parseAndValidateDate("NOW", "2026-09-04");
  assert.equal(parsedNow.valid, true);
  assert.equal(parsedNow.isoDate, "2026-09-04");
});

test("LOA CENTER REPOST: submitting a new LOA via modal reposts LOA Center to channel and deletes previous message via ctx.waitUntil", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);

  const doEntry = createMockLoaDO();
  doEntry.instance.setMeta("last_list_message_id", "msg_old_dashboard_999");
  guildMap.set("guild_vital", doEntry);

  const originalFetch = globalThis.fetch;
  const postedMessages = [];
  const deletedMessages = [];
  const waitedPromises = [];

  const ctx = {
    waitUntil: (p) => waitedPromises.push(p),
  };

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes(`/channels/${TEST_LOA_CHANNEL_ID}/messages`) && options.method === "POST") {
      const parsedBody = JSON.parse(options.body);
      const msgId = "msg_new_dashboard_111";
      postedMessages.push({ id: msgId, ...parsedBody });
      return new Response(JSON.stringify({ id: msgId }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && options.method === "DELETE") {
      deletedMessages.push(urlStr.split("/").pop());
      return new Response(null, { status: 204 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MODAL_SUBMIT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "Alex",
        user: { id: "staff_alex", username: "alex" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        custom_id: LoaCustomId.MODAL_START,
        components: [
          {
            type: 1,
            components: [{ custom_id: "start_date", value: "today" }],
          },
          {
            type: 1,
            components: [{ custom_id: "end_date", value: "09/15/2026" }],
          },
          {
            type: 1,
            components: [{ custom_id: "reason", value: "Out of town" }],
          },
        ],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, ctx);
    assert.equal(res.status, 200);

    // Wait for any waitUntil tasks to complete
    await Promise.all(waitedPromises);

    // 1. Fresh dashboard was posted to channel
    assert.equal(postedMessages.length, 1);
    assert.equal(postedMessages[0].id, "msg_new_dashboard_111");

    // 2. Old dashboard was deleted
    assert.equal(deletedMessages.length, 1);
    assert.equal(deletedMessages[0], "msg_old_dashboard_999");

    // 3. DO metadata has new message ID
    assert.equal(doEntry.instance.getMeta("last_list_message_id"), "msg_new_dashboard_111");

    // 4. Reposted content contains newly submitted LOA
    const container = postedMessages[0].components[0];
    const containerText = getContainerTexts(container);
    assert.ok(containerText.includes("🟢 **Alex**"));
    assert.ok(containerText.includes("> Out of town"));
    assert.ok(containerText.includes("-# 🏖️ Alex started an LOA • just now"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// LOA CENTER CHANNEL MIGRATION TESTS
// ============================================================================

test("CHANNEL MIGRATION: Moves LOA Center to 1546281163247722516 without deleting old messages or affecting active LOAs", async () => {
  const newChannelId = "1546281163247722516";
  const oldChannelId = "743517373985718274";

  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap, TEST_STAFF_ROLE_ID, newChannelId);

  // Pre-seed DO with existing active LOA and metadata pointing to old channel
  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_existing_active",
    guildId: "guild_vital",
    userId: "staff_veteran",
    displayName: "VeteranStaff",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    reason: "Long planned leave",
    todayIso: "2026-09-06",
  });
  // Simulate DO having stored the old channel's message ID and channel ID
  doEntry.instance.setMeta("last_list_message_id", "msg_old_channel_123");
  doEntry.instance.setMeta("last_list_channel_id", oldChannelId);
  guildMap.set("guild_vital", doEntry);

  const postedMessages = [];
  const deletedMessages = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      const parsedBody = JSON.parse(options.body);
      const msgId = `msg_new_${Date.now()}`;
      postedMessages.push({ url: urlStr, id: msgId, ...parsedBody });
      return new Response(JSON.stringify({ id: msgId }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && options.method === "DELETE") {
      const msgId = urlStr.split("/").pop();
      deletedMessages.push(msgId);
      return new Response(null, { status: 204 });
    }
    return originalFetch(url, options);
  };

  try {
    // 1. Refreshing or loading public LOA list in the new channel
    const result = await refreshPublicLoaList({
      env,
      guildId: "guild_vital",
      todayIso: "2026-09-06",
      repost: true,
    });

    assert.equal(result.success, true);

    // 2. Verified posted to NEW channel 1546281163247722516
    assert.equal(postedMessages.length, 1);
    assert.ok(postedMessages[0].url.includes(newChannelId));

    // 3. Existing LOA record is intact and rendered on the new panel
    const container = postedMessages[0].components[0];
    const text = getContainerTexts(container);
    assert.ok(text.includes("🟢 **VeteranStaff**"));
    assert.ok(text.includes("Sep 1 → Sep 30"));
    assert.ok(text.includes("> Long planned leave"));

    // 4. Old channel message was NOT deleted (deletedMessages is empty)
    assert.equal(deletedMessages.length, 0, "Old channel message must not be deleted");

    // 5. Metadata now tracks new channel ID and message ID
    assert.equal(doEntry.instance.getMeta("last_list_channel_id"), newChannelId);
    assert.equal(doEntry.instance.getMeta("last_list_message_id"), postedMessages[0].id);

    // 6. Interactions from old channel are rejected
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const oldChannelBody = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: oldChannelId, // Old channel
      member: {
        user: { id: "staff_veteran" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: { custom_id: LoaCustomId.BTN_STATUS },
    });
    const oldSig = await signDiscordPayload(oldChannelBody, keyPair, timestamp);
    const oldReq = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": oldSig,
        "x-signature-timestamp": timestamp,
      },
      body: oldChannelBody,
    });
    const oldRes = await worker.fetch(oldReq, env, {});
    const oldJson = await oldRes.json();
    assert.ok(oldJson.data.content.includes("designated LOA channel"));

    // 7. Interactions from new channel succeed
    const newChannelBody = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: newChannelId, // New channel
      member: {
        user: { id: "staff_veteran" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: { custom_id: LoaCustomId.BTN_STATUS },
    });
    const newSig = await signDiscordPayload(newChannelBody, keyPair, timestamp);
    const newReq = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": newSig,
        "x-signature-timestamp": timestamp,
      },
      body: newChannelBody,
    });
    const newRes = await worker.fetch(newReq, env, {});
    assert.equal(newRes.status, 200);
    const newJson = await newRes.json();
    assert.equal(newJson.type, InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE);
    const statusText = getContainerTexts(newJson.data.components[0]);
    assert.ok(statusText.includes("Your LOA"));
    assert.ok(statusText.includes("🟢 Active"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// LOA ROLE MANAGEMENT, AUDITING, & HIERARCHY TESTS
// ============================================================================

test("ROLE UTILS: calculateLoaRoleSwapDiff with preserve list (typical 6 roles)", () => {
  const staffRoleId = "743422836223246366";
  const seniorModId = "743422836223246377";
  const whitelistId = DEFAULT_ROLE_WHITELIST_APPROVED;
  const warriorId = DEFAULT_ROLE_KEYBOARD_WARRIOR;
  const gifId = DEFAULT_ROLE_GIF;
  const memberId = DEFAULT_ROLE_MEMBER;
  const staffLoaId = DEFAULT_STAFF_LOA_ROLE_ID;

  const currentRoles = [
    staffRoleId,
    seniorModId,
    whitelistId,
    warriorId,
    gifId,
    memberId,
  ];

  const roleMap = new Map([
    [staffRoleId, { id: staffRoleId, name: "StaffTeam", position: 20 }],
    [seniorModId, { id: seniorModId, name: "Senior Moderator", position: 18 }],
    [whitelistId, { id: whitelistId, name: "Whitelist Approved", position: 10 }],
    [warriorId, { id: warriorId, name: "Keyboard Warrior", position: 8 }],
    [gifId, { id: gifId, name: "Gif", position: 5 }],
    [memberId, { id: memberId, name: "Member", position: 2 }],
    [staffLoaId, { id: staffLoaId, name: "LOA", position: 15 }],
  ]);

  const diff = calculateLoaRoleSwapDiff({
    guildId: "guild_vital",
    currentRoleIds: currentRoles,
    preservedRoleIds: DEFAULT_PRESERVED_ROLE_IDS,
    staffLoaRoleId: staffLoaId,
    roleMap,
  });

  // Removable roles to snapshot: 2 staff roles
  assert.equal(diff.rolesToSnapshot.length, 2);
  assert.ok(diff.rolesToSnapshot.includes(staffRoleId));
  assert.ok(diff.rolesToSnapshot.includes(seniorModId));

  // Preserved player roles found: 4 roles
  assert.equal(diff.preservedRolesFound.length, 4);
  assert.ok(diff.preservedRolesFound.includes(whitelistId));
  assert.ok(diff.preservedRolesFound.includes(warriorId));
  assert.ok(diff.preservedRolesFound.includes(gifId));
  assert.ok(diff.preservedRolesFound.includes(memberId));

  // Target roles array: 4 preserved roles + 1 Staff LOA role = 5 roles
  assert.equal(diff.targetRoles.length, 5);
  assert.ok(diff.targetRoles.includes(staffLoaId));
  assert.ok(!diff.targetRoles.includes(staffRoleId));
  assert.ok(!diff.targetRoles.includes(seniorModId));
});

test("ROLE UTILS: calculateLoaRoleSwapDiff with 25+ roles and managed roles", () => {
  const staffLoaId = DEFAULT_STAFF_LOA_ROLE_ID;
  const preserved = [...DEFAULT_PRESERVED_ROLE_IDS];
  const managedRoles = ["managed_booster_role", "managed_bot_integration"];
  const staffRoles = [];
  for (let i = 1; i <= 19; i++) {
    staffRoles.push(`staff_dept_role_${i}`);
  }

  const allMemberRoles = [...preserved, ...managedRoles, ...staffRoles];
  assert.equal(allMemberRoles.length, 25);

  const roleMap = new Map();
  for (const rid of preserved) {
    roleMap.set(rid, { id: rid, name: `Preserved_${rid}`, position: 5 });
  }
  for (const rid of managedRoles) {
    roleMap.set(rid, { id: rid, name: `Managed_${rid}`, position: 12, managed: true });
  }
  for (let i = 0; i < staffRoles.length; i++) {
    roleMap.set(staffRoles[i], { id: staffRoles[i], name: `Staff_${i}`, position: 20 + i });
  }
  roleMap.set(staffLoaId, { id: staffLoaId, name: "LOA", position: 15 });

  const diff = calculateLoaRoleSwapDiff({
    guildId: "guild_vital",
    currentRoleIds: allMemberRoles,
    preservedRoleIds: preserved,
    staffLoaRoleId: staffLoaId,
    roleMap,
  });

  // Managed roles must NOT be snapshotted or removed
  assert.equal(diff.managedRolesUntouched.length, 2);
  assert.ok(diff.managedRolesUntouched.includes("managed_booster_role"));
  assert.ok(diff.managedRolesUntouched.includes("managed_bot_integration"));

  // Only the 19 staff roles should be snapshotted
  assert.equal(diff.rolesToSnapshot.length, 19);

  // Target roles must have: 4 preserved + 2 managed + 1 Staff LOA = 7 roles
  assert.equal(diff.targetRoles.length, 7);
  assert.ok(diff.targetRoles.includes(staffLoaId));
  assert.ok(diff.targetRoles.includes("managed_booster_role"));
  assert.ok(diff.targetRoles.includes("managed_bot_integration"));
});

test("ROLE UTILS: validateRoleHierarchy blocks swap if removable role >= bot position", () => {
  const staffLoaId = DEFAULT_STAFF_LOA_ROLE_ID;
  const unmanageableRole = "high_admin_role";
  const roleMap = new Map([
    [staffLoaId, { id: staffLoaId, name: "LOA", position: 10 }],
    ["normal_staff_role", { id: "normal_staff_role", name: "Staff", position: 20 }],
    [unmanageableRole, { id: unmanageableRole, name: "Management Role", position: 99 }],
  ]);

  const botHighestPosition = 50; // Bot is position 50, but user has position 99

  const check = validateRoleHierarchy({
    botHighestPosition,
    staffLoaRoleId: staffLoaId,
    rolesToManage: ["normal_staff_role", unmanageableRole],
    roleMap,
  });

  assert.equal(check.valid, false);
  assert.ok(check.error.includes("hierarchy"));
  assert.equal(check.unmanageableRole.id, unmanageableRole);
});

test("ROLE UTILS: validateRoleHierarchy blocks swap if Staff LOA role >= bot position", () => {
  const staffLoaId = DEFAULT_STAFF_LOA_ROLE_ID;
  const roleMap = new Map([
    [staffLoaId, { id: staffLoaId, name: "LOA", position: 80 }],
    ["normal_staff_role", { id: "normal_staff_role", name: "Staff", position: 20 }],
  ]);

  const botHighestPosition = 50; // Bot is position 50, Staff LOA is 80

  const check = validateRoleHierarchy({
    botHighestPosition,
    staffLoaRoleId: staffLoaId,
    rolesToManage: ["normal_staff_role"],
    roleMap,
  });

  assert.equal(check.valid, false);
  assert.ok(check.error.includes("higher than Damo Bot's highest role"));
  assert.equal(check.unmanageableRole.id, staffLoaId);
});

test("ROLE SWAP: aborts and removes 0 roles if database snapshot storage fails", async () => {
  const originalFetch = globalThis.fetch;
  let patchSent = false;

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/guilds/") && urlStr.includes("/roles")) {
      return new Response(
        JSON.stringify([
          { id: "bot_role", name: "Bot Role", position: 100 },
          { id: TEST_STAFF_ROLE_ID, name: "StaffTeam", position: 10 },
          { id: DEFAULT_STAFF_LOA_ROLE_ID, name: "LOA", position: 9 },
        ]),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/@me")) {
      return new Response(
        JSON.stringify({ roles: ["bot_role"] }),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/staff_test_user") && options.method === "PATCH") {
      patchSent = true;
      return new Response(JSON.stringify({ roles: [] }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  // Mock DO stub where role-snapshot fails with 500
  const mockStub = {
    fetch: async (url) => {
      if (String(url).includes("/loa/role-snapshot")) {
        return new Response(
          JSON.stringify({ success: false, error: "Database lock error" }),
          { status: 500 }
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  };

  const swapResult = await executeLoaRoleSwap({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "staff_test_user",
    currentMemberRoles: [TEST_STAFF_ROLE_ID],
    stub: mockStub,
    loaId: "loa_fail_storage",
    customFetch: mockCustomFetch,
  });

  assert.equal(swapResult.success, false);
  assert.ok(swapResult.error.includes("Failed to save role snapshot to database"));
  // CRITICAL: No patch was ever sent to Discord to remove roles
  assert.equal(patchSent, false);
});

test("ROLE SWAP: executes atomic PATCH with exact target roles on success", async () => {
  let patchPayload = null;
  const staffLoaId = DEFAULT_STAFF_LOA_ROLE_ID;

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/guilds/") && urlStr.includes("/roles")) {
      return new Response(
        JSON.stringify([
          { id: "bot_role", name: "Bot Role", position: 100 },
          { id: TEST_STAFF_ROLE_ID, name: "StaffTeam", position: 10 },
          { id: DEFAULT_ROLE_WHITELIST_APPROVED, name: "Whitelist Approved", position: 5 },
          { id: staffLoaId, name: "LOA", position: 9 },
        ]),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/@me")) {
      return new Response(JSON.stringify({ roles: ["bot_role"] }), { status: 200 });
    }
    if (urlStr.includes("/members/staff_user_atomic") && options.method === "PATCH") {
      patchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ roles: patchPayload.roles }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_atomic_test",
    guildId: "guild_vital",
    userId: "staff_user_atomic",
    displayName: "AtomicUser",
    startDate: "2026-09-02",
    endDate: "2026-09-10",
    reason: "Vacation",
    todayIso: "2026-09-02",
  });

  const swapResult = await executeLoaRoleSwap({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "staff_user_atomic",
    currentMemberRoles: [TEST_STAFF_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
    stub: {
      fetch: (url, opts) => doEntry.instance.fetch(new Request(url, opts)),
    },
    loaId: "loa_atomic_test",
    customFetch: mockCustomFetch,
  });

  assert.equal(swapResult.success, true);
  assert.ok(patchPayload != null);
  // Atomic payload must retain Whitelist Approved and add Staff LOA
  assert.equal(patchPayload.roles.length, 2);
  assert.ok(patchPayload.roles.includes(DEFAULT_ROLE_WHITELIST_APPROVED));
  assert.ok(patchPayload.roles.includes(staffLoaId));
  assert.ok(!patchPayload.roles.includes(TEST_STAFF_ROLE_ID));

  // Verify DO record updated with role snapshot
  const rec = doEntry.instance.getLoaById("loa_atomic_test");
  assert.equal(rec.role_swap_status, "completed");
  assert.ok(rec.removed_role_ids.includes(TEST_STAFF_ROLE_ID));
});

test("ROLE RESTORE: atomic restoration restores snapshotted roles and removes Staff LOA", async () => {
  let patchPayload = null;
  const staffLoaId = DEFAULT_STAFF_LOA_ROLE_ID;

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/staff_user_restore") && options.method === "GET") {
      // Currently has Staff LOA and Whitelist Approved
      return new Response(
        JSON.stringify({ roles: [staffLoaId, DEFAULT_ROLE_WHITELIST_APPROVED] }),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/staff_user_restore") && options.method === "PATCH") {
      patchPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ roles: patchPayload.roles }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_restore_test",
    guildId: "guild_vital",
    userId: "staff_user_restore",
    displayName: "RestoreUser",
    startDate: "2026-09-02",
    endDate: "2026-09-10",
    reason: "Vacation",
    todayIso: "2026-09-02",
    removedRoleIds: [TEST_STAFF_ROLE_ID],
    roleSwapStatus: "completed",
  });

  const loaRecord = doEntry.instance.getLoaById("loa_restore_test");

  const restoreResult = await executeLoaRoleRestore({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "staff_user_restore",
    loaRecord,
    stub: {
      fetch: (url, opts) => doEntry.instance.fetch(new Request(url, opts)),
    },
    customFetch: mockCustomFetch,
  });

  assert.equal(restoreResult.success, true);
  assert.ok(patchPayload != null);
  // Restored roles must include TEST_STAFF_ROLE_ID and omit staffLoaId
  assert.ok(patchPayload.roles.includes(TEST_STAFF_ROLE_ID));
  assert.ok(patchPayload.roles.includes(DEFAULT_ROLE_WHITELIST_APPROVED));
  assert.ok(!patchPayload.roles.includes(staffLoaId));

  // Verify DO updated
  const updatedRec = doEntry.instance.getLoaById("loa_restore_test");
  assert.equal(updatedRec.role_restore_status, "completed");
  assert.ok(updatedRec.restored_role_ids.includes(TEST_STAFF_ROLE_ID));
});

test("ROLE RESTORE: deleted role fallback with individual PUT/DELETE", async () => {
  const staffLoaId = DEFAULT_STAFF_LOA_ROLE_ID;
  const validRole = TEST_STAFF_ROLE_ID;
  const deletedRole = "deleted_server_role_999";
  const putCalls = [];
  let deleteStaffLoaCalled = false;

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/staff_deleted_role") && options.method === "GET") {
      return new Response(
        JSON.stringify({ roles: [staffLoaId, DEFAULT_ROLE_WHITELIST_APPROVED] }),
        { status: 200 }
      );
    }
    // Atomic PATCH fails with 400 because a role was deleted from the server
    if (urlStr.includes("/members/staff_deleted_role") && options.method === "PATCH") {
      return new Response(
        JSON.stringify({ code: 10011, message: "Unknown Role" }),
        { status: 400 }
      );
    }
    // Individual PUT for valid role succeeds
    if (urlStr.includes(`/roles/${validRole}`) && options.method === "PUT") {
      putCalls.push(validRole);
      return new Response(null, { status: 204 });
    }
    // Individual PUT for deleted role fails with 404
    if (urlStr.includes(`/roles/${deletedRole}`) && options.method === "PUT") {
      return new Response(
        JSON.stringify({ code: 10011, message: "Unknown Role" }),
        { status: 404 }
      );
    }
    // Individual DELETE for Staff LOA succeeds
    if (urlStr.includes(`/roles/${staffLoaId}`) && options.method === "DELETE") {
      deleteStaffLoaCalled = true;
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_deleted_role_test",
    guildId: "guild_vital",
    userId: "staff_deleted_role",
    displayName: "DeletedRoleUser",
    startDate: "2026-09-02",
    endDate: "2026-09-10",
    reason: "Vacation",
    todayIso: "2026-09-02",
    removedRoleIds: [validRole, deletedRole],
    roleSwapStatus: "completed",
  });

  const loaRecord = doEntry.instance.getLoaById("loa_deleted_role_test");

  const restoreResult = await executeLoaRoleRestore({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "staff_deleted_role",
    loaRecord,
    stub: {
      fetch: (url, opts) => doEntry.instance.fetch(new Request(url, opts)),
    },
    customFetch: mockCustomFetch,
  });

  assert.equal(restoreResult.success, true);
  assert.ok(putCalls.includes(validRole));
  assert.equal(deleteStaffLoaCalled, true);
  // Deleted role must be tracked in failedRestoreRoleIds
  assert.ok(restoreResult.failedRestoreRoleIds.includes(deletedRole));
  assert.ok(restoreResult.restoredRoleIds.includes(validRole));

  // Verify DO recorded the failure gracefully without crashing
  const updatedRec = doEntry.instance.getLoaById("loa_deleted_role_test");
  assert.equal(updatedRec.role_restore_status, "partial");
  assert.ok(updatedRec.failed_restore_role_ids.includes(deletedRole));
});

test("ROLE RESTORE: legacy LOA record without snapshot is flagged as legacy", async () => {
  const staffLoaId = DEFAULT_STAFF_LOA_ROLE_ID;
  let deletedLoaRole = false;

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/staff_legacy_user") && options.method === "GET") {
      return new Response(
        JSON.stringify({ roles: [staffLoaId, DEFAULT_ROLE_WHITELIST_APPROVED] }),
        { status: 200 }
      );
    }
    if (urlStr.includes(`/roles/${staffLoaId}`) && options.method === "DELETE") {
      deletedLoaRole = true;
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_legacy_test",
    guildId: "guild_vital",
    userId: "staff_legacy_user",
    displayName: "LegacyUser",
    startDate: "2026-09-02",
    endDate: "2026-09-10",
    reason: "Old LOA",
    todayIso: "2026-09-02",
  });

  const loaRecord = doEntry.instance.getLoaById("loa_legacy_test");
  // Legacy record has null/empty removed_role_ids
  assert.equal(loaRecord.removed_role_ids, null);

  const restoreResult = await executeLoaRoleRestore({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "staff_legacy_user",
    loaRecord,
    stub: {
      fetch: (url, opts) => doEntry.instance.fetch(new Request(url, opts)),
    },
    customFetch: mockCustomFetch,
  });

  assert.equal(restoreResult.success, true);
  assert.equal(restoreResult.isLegacy, true);
  assert.equal(deletedLoaRole, true);

  const updatedRec = doEntry.instance.getLoaById("loa_legacy_test");
  assert.equal(updatedRec.is_legacy_snapshot, 1);
});

test("AUDIT LOGGING: logLoaStarted, logLoaEnded, and logLoaWarning format embeds to #loa-logs", async () => {
  const postedLogs = [];

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      const body = JSON.parse(options.body);
      postedLogs.push({ url: urlStr, ...body });
      return new Response(JSON.stringify({ id: "log_msg_123" }), { status: 200 });
    }
    if (urlStr.includes("/guilds/") && urlStr.includes("/roles")) {
      return new Response(
        JSON.stringify([
          { id: TEST_STAFF_ROLE_ID, name: "StaffTeam" },
          { id: DEFAULT_STAFF_LOA_ROLE_ID, name: "LOA" },
        ]),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const env = {
    DISCORD_BOT_TOKEN: "mock_token",
    LOA_LOG_CHANNEL_ID: DEFAULT_LOA_LOG_CHANNEL_ID,
  };

  // 1. Test logLoaStarted
  await logLoaStarted({
    env,
    guildId: "guild_vital",
    userId: "staff_logged_user",
    loa: {
      id: "loa_log_1",
      start_date: "2026-09-08",
      end_date: "2026-09-15",
      reason: "Vacation in Miami",
    },
    removedRoleIds: [TEST_STAFF_ROLE_ID],
    preservedRoleIds: [DEFAULT_ROLE_WHITELIST_APPROVED],
    customFetch: mockCustomFetch,
  });

  assert.equal(postedLogs.length, 1);
  assert.ok(postedLogs[0].url.includes(DEFAULT_LOA_LOG_CHANNEL_ID));
  const startEmbed = postedLogs[0].embeds[0];
  assert.equal(startEmbed.title, "🏖️ Staff LOA Started");
  assert.ok(startEmbed.description.includes("<@staff_logged_user>"));
  assert.ok(startEmbed.description.includes("Vacation in Miami"));

  // 2. Test logLoaEnded
  await logLoaEnded({
    env,
    guildId: "guild_vital",
    userId: "staff_logged_user",
    displayName: "LoggedUser",
    reasonText: "returned early from Leave of Absence",
    restoredRoleIds: [TEST_STAFF_ROLE_ID],
    failedRestoreRoleIds: [],
    customFetch: mockCustomFetch,
  });

  assert.equal(postedLogs.length, 2);
  const endEmbed = postedLogs[1].embeds[0];
  assert.equal(endEmbed.title, "✅ Staff Returned from LOA");
  assert.ok(endEmbed.description.includes("returned early"));

  // 3. Test logLoaWarning
  await logLoaWarning({
    env,
    guildId: "guild_vital",
    userId: "staff_logged_user",
    message: "Failed to restore deleted role",
    customFetch: mockCustomFetch,
  });

  assert.equal(postedLogs.length, 3);
  const warnEmbed = postedLogs[2].embeds[0];
  assert.equal(warnEmbed.title, "⚠️ Staff LOA Warning / Action Required");
  assert.ok(warnEmbed.description.includes("Failed to restore deleted role"));
});

test("ADMIN INFO COMMAND: /loainfo permission check and history rendering", async () => {
  const doEntry = createMockLoaDO();
  doEntry.instance.createLoa({
    id: "loa_info_hist_1",
    guildId: "guild_vital",
    userId: "staff_target_user",
    displayName: "TargetStaff",
    startDate: "2026-08-01",
    endDate: "2026-08-08",
    reason: "Summer Trip",
    todayIso: "2026-08-01",
    removedRoleIds: [TEST_STAFF_ROLE_ID],
    roleSwapStatus: "completed",
  });

  const env = {
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_LOA: {
      idFromName: () => "guild_vital",
      get: () => ({
        fetch: (url, opts) => doEntry.instance.fetch(new Request(url, opts)),
      }),
    },
    VRP_MANAGEMENT_ROLE_ID: DEFAULT_VRP_MANAGEMENT_ROLE_ID,
    OWNER_ROLE_ID: DEFAULT_OWNER_ROLE_ID,
  };

  // 1. Regular staff member (not Management or Owner) -> Rejected
  const regularStaffInteraction = {
    guild_id: "guild_vital",
    member: {
      roles: [TEST_STAFF_ROLE_ID],
      user: { id: "regular_staff" },
    },
    data: {
      name: "loainfo",
      options: [{ name: "member", value: "staff_target_user", type: 6 }],
    },
  };

  const regRes = await handleLoaInfoCommand(regularStaffInteraction, env);
  const regJson = await regRes.json();
  assert.ok(regJson.data.content.includes("Permission denied"));

  // 2. Management member -> Allowed & returns LOA history container
  const managementInteraction = {
    guild_id: "guild_vital",
    member: {
      roles: [DEFAULT_VRP_MANAGEMENT_ROLE_ID],
      user: { id: "mgmt_user" },
    },
    data: {
      name: "loainfo",
      options: [{ name: "member", value: "staff_target_user", type: 6 }],
      resolved: {
        users: {
          staff_target_user: { id: "staff_target_user", username: "targetstaff", global_name: "TargetStaff" },
        },
      },
    },
  };

  const mgmtRes = await handleLoaInfoCommand(managementInteraction, env);
  assert.equal(mgmtRes.status, 200);
  const mgmtJson = await mgmtRes.json();
  assert.equal(mgmtJson.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
  const containerText = getContainerTexts(mgmtJson.data.components[0]);
  assert.ok(containerText.includes("Staff LOA History: TargetStaff"));
  assert.ok(containerText.includes("Summer Trip"));
  assert.ok(containerText.includes("Snapshot (1 roles)"));
});

test("CRON ROLLOVER: processCronRollover automatically restores roles for completed LOAs", async () => {
  const staffLoaId = DEFAULT_STAFF_LOA_ROLE_ID;
  let memberPatched = false;

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/staff_rollover_user") && options.method === "GET") {
      return new Response(
        JSON.stringify({ roles: [staffLoaId, DEFAULT_ROLE_WHITELIST_APPROVED] }),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/staff_rollover_user") && options.method === "PATCH") {
      memberPatched = true;
      return new Response(JSON.stringify({ roles: [TEST_STAFF_ROLE_ID] }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const env = {
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_LOA_ROLE_ID: staffLoaId,
    LOA_LOG_CHANNEL_ID: DEFAULT_LOA_LOG_CHANNEL_ID,
  };

  const doEntry = createMockLoaDO(env);
  // Create an LOA that ended yesterday
  doEntry.instance.createLoa({
    id: "loa_rollover_done",
    guildId: "guild_vital",
    userId: "staff_rollover_user",
    displayName: "RolloverUser",
    startDate: "2026-08-20",
    endDate: "2026-09-06",
    reason: "Vacation",
    todayIso: "2026-08-20",
    removedRoleIds: [TEST_STAFF_ROLE_ID],
    roleSwapStatus: "completed",
  });

  const todayIso = "2026-09-07";
  await doEntry.instance.processCronRollover({
    env,
    todayIso,
    customFetch: mockCustomFetch,
  });

  // Verify member had roles restored via Discord REST PATCH
  assert.equal(memberPatched, true);

  // Verify DO status updated
  const updatedRec = doEntry.instance.getLoaById("loa_rollover_done");
  assert.equal(updatedRec.role_restore_status, "completed");
  assert.ok(updatedRec.restored_role_ids.includes(TEST_STAFF_ROLE_ID));
});

// ============================================================================
// LEADERSHIP PRESERVATION & DEDICATED LOA ROLE SUITE (ADMIN+, MOD, SUPPORT)
// ============================================================================

test("ROLE UTILS: isProtectedStaffRole identifies Administrator and higher leadership correctly", () => {
  // Leadership roles (Administrator and above)
  assert.equal(isProtectedStaffRole([DEFAULT_ADMIN_ROLE_ID]), true);
  assert.equal(isProtectedStaffRole([DEFAULT_SENIOR_ADMIN_ROLE_ID]), true);
  assert.equal(isProtectedStaffRole([DEFAULT_HEAD_ADMIN_ROLE_ID]), true);
  assert.equal(isProtectedStaffRole([DEFAULT_HEAD_OF_STAFF_ROLE_ID]), true);
  assert.equal(isProtectedStaffRole([DEFAULT_VRP_MANAGEMENT_ROLE_ID]), true);

  // Mixed roles with at least one leadership role
  assert.equal(
    isProtectedStaffRole([
      DEFAULT_ROLE_WHITELIST_APPROVED,
      DEFAULT_ADMIN_ROLE_ID,
      DEFAULT_MODERATOR_ROLE_ID,
    ]),
    true
  );

  // Lower staff & non-leadership roles
  assert.equal(isProtectedStaffRole([DEFAULT_MODERATOR_ROLE_ID]), false);
  assert.equal(isProtectedStaffRole([DEFAULT_SUPPORT_STAFF_ROLE_ID]), false);
  assert.equal(isProtectedStaffRole([TEST_STAFF_ROLE_ID]), false);
  assert.equal(isProtectedStaffRole([DEFAULT_ROLE_MEMBER, DEFAULT_ROLE_WHITELIST_APPROVED]), false);
  assert.equal(isProtectedStaffRole([]), false);
  assert.equal(isProtectedStaffRole(null), false);
});

test("ROLE UTILS: determineLoaRoleToAssign selects LOA - Moderator vs LOA - Support based on pre-LOA roles", () => {
  const loaRoles = {
    moderator: DEFAULT_LOA_MODERATOR_ROLE_ID,
    support: DEFAULT_LOA_SUPPORT_ROLE_ID,
  };

  // Moderator only -> LOA - Moderator
  assert.equal(
    determineLoaRoleToAssign({
      currentRoleIds: [DEFAULT_MODERATOR_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
      loaRoles,
    }),
    DEFAULT_LOA_MODERATOR_ROLE_ID
  );

  // Moderator and Support -> LOA - Moderator (higher privilege)
  assert.equal(
    determineLoaRoleToAssign({
      currentRoleIds: [DEFAULT_MODERATOR_ROLE_ID, DEFAULT_SUPPORT_STAFF_ROLE_ID],
      loaRoles,
    }),
    DEFAULT_LOA_MODERATOR_ROLE_ID
  );

  // Support only -> LOA - Support
  assert.equal(
    determineLoaRoleToAssign({
      currentRoleIds: [DEFAULT_SUPPORT_STAFF_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
      loaRoles,
    }),
    DEFAULT_LOA_SUPPORT_ROLE_ID
  );

  // Generic staff -> falls back to LOA - Support
  assert.equal(
    determineLoaRoleToAssign({
      currentRoleIds: [TEST_STAFF_ROLE_ID],
      loaRoles,
    }),
    DEFAULT_LOA_SUPPORT_ROLE_ID
  );
});

test("ROLE UTILS: calculateLoaRoleSwapDiff for Protected Leadership makes zero role changes and assigns no LOA role", () => {
  const leadershipRoles = [
    { name: "Administrator", id: DEFAULT_ADMIN_ROLE_ID },
    { name: "Senior Administrator", id: DEFAULT_SENIOR_ADMIN_ROLE_ID },
    { name: "Head Administrator", id: DEFAULT_HEAD_ADMIN_ROLE_ID },
    { name: "Head of Staff", id: DEFAULT_HEAD_OF_STAFF_ROLE_ID },
    { name: "VRP Management", id: DEFAULT_VRP_MANAGEMENT_ROLE_ID },
  ];

  for (const leader of leadershipRoles) {
    const currentRoles = [
      leader.id,
      DEFAULT_ROLE_WHITELIST_APPROVED,
      DEFAULT_ROLE_MEMBER,
    ];

    const diff = calculateLoaRoleSwapDiff({
      guildId: "guild_vital",
      currentRoleIds: currentRoles,
    });

    assert.equal(diff.isProtectedStaff, true, `${leader.name} should be recognized as protected`);
    assert.equal(diff.assignedLoaRoleId, null, `${leader.name} should NOT receive any LOA role`);
    assert.deepEqual(diff.rolesToSnapshot, [], `${leader.name} should have 0 snapshotted roles`);
    assert.deepEqual(
      diff.targetRoles,
      currentRoles,
      `${leader.name} target roles must match current roles untouched`
    );
  }
});

test("ROLE UTILS: calculateLoaRoleSwapDiff assigns LOA - Support vs LOA - Moderator to lower staff and snapshots regular staff roles", () => {
  // Support staff member
  const supportRoles = [
    DEFAULT_SUPPORT_STAFF_ROLE_ID,
    DEFAULT_ROLE_WHITELIST_APPROVED,
    DEFAULT_ROLE_MEMBER,
  ];

  const supportDiff = calculateLoaRoleSwapDiff({
    guildId: "guild_vital",
    currentRoleIds: supportRoles,
  });

  assert.equal(supportDiff.isProtectedStaff, false);
  assert.equal(supportDiff.assignedLoaRoleId, DEFAULT_LOA_SUPPORT_ROLE_ID);
  assert.ok(supportDiff.rolesToSnapshot.includes(DEFAULT_SUPPORT_STAFF_ROLE_ID));
  assert.ok(supportDiff.targetRoles.includes(DEFAULT_LOA_SUPPORT_ROLE_ID));
  assert.ok(supportDiff.targetRoles.includes(DEFAULT_ROLE_WHITELIST_APPROVED));
  assert.ok(!supportDiff.targetRoles.includes(DEFAULT_SUPPORT_STAFF_ROLE_ID));
  assert.ok(!supportDiff.targetRoles.includes(DEFAULT_LOA_MODERATOR_ROLE_ID));

  // Moderator member
  const modRoles = [
    DEFAULT_MODERATOR_ROLE_ID,
    DEFAULT_SUPPORT_STAFF_ROLE_ID,
    DEFAULT_ROLE_WHITELIST_APPROVED,
  ];

  const modDiff = calculateLoaRoleSwapDiff({
    guildId: "guild_vital",
    currentRoleIds: modRoles,
  });

  assert.equal(modDiff.isProtectedStaff, false);
  assert.equal(modDiff.assignedLoaRoleId, DEFAULT_LOA_MODERATOR_ROLE_ID);
  assert.ok(modDiff.rolesToSnapshot.includes(DEFAULT_MODERATOR_ROLE_ID));
  assert.ok(modDiff.rolesToSnapshot.includes(DEFAULT_SUPPORT_STAFF_ROLE_ID));
  assert.ok(modDiff.targetRoles.includes(DEFAULT_LOA_MODERATOR_ROLE_ID));
  assert.ok(modDiff.targetRoles.includes(DEFAULT_ROLE_WHITELIST_APPROVED));
  assert.ok(!modDiff.targetRoles.includes(DEFAULT_MODERATOR_ROLE_ID));
  assert.ok(!modDiff.targetRoles.includes(DEFAULT_SUPPORT_STAFF_ROLE_ID));
  assert.ok(!modDiff.targetRoles.includes(DEFAULT_LOA_SUPPORT_ROLE_ID));
});

test("ROLE SWAP & RESTORE: Protected Staff skips Discord REST role API calls entirely on swap and restore", async () => {
  let patchSent = false;
  let snapshotSaved = false;
  let restoreSaved = false;

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/admin_user") && options.method === "PATCH") {
      patchSent = true;
      return new Response(JSON.stringify({ roles: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const mockStub = {
    fetch: async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("/loa/role-snapshot") && options.method === "POST") {
        snapshotSaved = true;
        const body = JSON.parse(options.body);
        assert.equal(body.isProtectedStaff, 1);
        assert.equal(body.status, "completed");
        assert.equal(body.assignedLoaRoleId, null);
        assert.deepEqual(body.removedRoleIds, []);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (urlStr.includes("/loa/role-restore") && options.method === "POST") {
        restoreSaved = true;
        const body = JSON.parse(options.body);
        assert.equal(body.status, "completed");
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  };

  // 1. Swap for Administrator
  const swapResult = await executeLoaRoleSwap({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "admin_user",
    currentMemberRoles: [DEFAULT_ADMIN_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
    stub: mockStub,
    loaId: "loa_admin_1",
    customFetch: mockCustomFetch,
  });

  assert.equal(swapResult.success, true);
  assert.equal(swapResult.isProtectedStaff, true);
  assert.equal(patchSent, false, "Protected staff must NOT trigger Discord role PATCH");
  assert.equal(snapshotSaved, true, "Snapshot status must be saved to DO");

  // 2. Restore for Administrator
  const restoreResult = await executeLoaRoleRestore({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "admin_user",
    currentMemberRoles: [DEFAULT_ADMIN_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
    stub: mockStub,
    loaId: "loa_admin_1",
    loaRecord: {
      id: "loa_admin_1",
      is_protected_staff: 1,
      removed_role_ids: [],
    },
    customFetch: mockCustomFetch,
  });

  assert.equal(restoreResult.success, true);
  assert.equal(restoreResult.isProtectedStaff, true);
  assert.equal(patchSent, false, "Protected staff restore must NOT trigger Discord role PATCH");
  assert.equal(restoreSaved, true, "Restore status must be saved to DO");
});

test("ROLE SWAP & RESTORE: Support Staff and Moderator swap and restore lifecycle", async () => {
  let patchRolesApplied = null;

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/guilds/") && urlStr.includes("/roles")) {
      return new Response(
        JSON.stringify([
          { id: "bot_role", name: "Bot Role", position: 100 },
          { id: DEFAULT_SUPPORT_STAFF_ROLE_ID, name: "Support Staff", position: 10 },
          { id: DEFAULT_ROLE_WHITELIST_APPROVED, name: "Whitelist Approved", position: 5 },
          { id: DEFAULT_LOA_SUPPORT_ROLE_ID, name: "LOA - Support", position: 9 },
          { id: DEFAULT_LOA_MODERATOR_ROLE_ID, name: "LOA - Moderator", position: 9 },
        ]),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/@me")) {
      return new Response(
        JSON.stringify({ roles: ["bot_role"] }),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/support_user") && (options.method === "GET" || !options.method)) {
      return new Response(
        JSON.stringify({
          roles: patchRolesApplied || [DEFAULT_LOA_SUPPORT_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
        }),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/support_user") && options.method === "PATCH") {
      const b = JSON.parse(options.body);
      patchRolesApplied = b.roles;
      return new Response(JSON.stringify({ roles: patchRolesApplied }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const mockStub = {
    fetch: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
  };

  // 1. Support Swap
  const swapResult = await executeLoaRoleSwap({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "support_user",
    currentMemberRoles: [DEFAULT_SUPPORT_STAFF_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
    stub: mockStub,
    loaId: "loa_support_1",
    customFetch: mockCustomFetch,
  });

  assert.equal(swapResult.success, true);
  assert.equal(swapResult.isProtectedStaff, false);
  assert.equal(swapResult.assignedLoaRoleId, DEFAULT_LOA_SUPPORT_ROLE_ID);
  assert.ok(patchRolesApplied.includes(DEFAULT_LOA_SUPPORT_ROLE_ID));
  assert.ok(patchRolesApplied.includes(DEFAULT_ROLE_WHITELIST_APPROVED));
  assert.ok(!patchRolesApplied.includes(DEFAULT_SUPPORT_STAFF_ROLE_ID));

  // 2. Support Restore
  const restoreResult = await executeLoaRoleRestore({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "support_user",
    currentMemberRoles: [DEFAULT_LOA_SUPPORT_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
    stub: mockStub,
    loaId: "loa_support_1",
    loaRecord: {
      id: "loa_support_1",
      is_protected_staff: 0,
      removed_role_ids: [DEFAULT_SUPPORT_STAFF_ROLE_ID],
    },
    customFetch: mockCustomFetch,
  });

  assert.equal(restoreResult.success, true);
  assert.ok(patchRolesApplied.includes(DEFAULT_SUPPORT_STAFF_ROLE_ID));
  assert.ok(patchRolesApplied.includes(DEFAULT_ROLE_WHITELIST_APPROVED));
  assert.ok(!patchRolesApplied.includes(DEFAULT_LOA_SUPPORT_ROLE_ID));
  assert.ok(!patchRolesApplied.includes(DEFAULT_LOA_MODERATOR_ROLE_ID));
});

test("LOA HANDLER: Administrator starting LOA preserves roles, sets nickname, and displays leadership confirmation", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);
  const doEntry = createMockLoaDO(env);
  guildMap.set("guild_vital", doEntry);

  let memberPatched = false;
  let patchedNick = null;
  let patchedRoles = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/admin_staff_1") && options.method === "PATCH") {
      memberPatched = true;
      const b = JSON.parse(options.body || "{}");
      if (b.nick !== undefined) patchedNick = b.nick;
      if (b.roles !== undefined) patchedRoles = b.roles;
      return new Response(JSON.stringify({ nick: patchedNick, roles: [DEFAULT_ADMIN_ROLE_ID] }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_admin_start" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const today = getTodayInChicago();
    const [y, m, d] = today.split("-").map(Number);

    const body = JSON.stringify({
      type: InteractionType.MODAL_SUBMIT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "AdminBoss",
        user: { id: "admin_staff_1", username: "adminboss" },
        roles: [DEFAULT_ADMIN_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
      },
      data: {
        custom_id: LoaCustomId.MODAL_START,
        components: [
          { type: 1, components: [{ custom_id: "start_date", value: "today" }] },
          { type: 1, components: [{ custom_id: "end_date", value: `${m}/${d + 5}/${y}` }] },
          { type: 1, components: [{ custom_id: "reason", value: "Executive Retreat" }] },
        ],
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
    const json = await res.json();
    const text = getContainerTexts(json.data.components[0]);

    // Check confirmation text highlights Leadership preservation
    assert.ok(text.includes("Leadership Status"));
    assert.ok(text.includes("All your server roles have been preserved during your Leave of Absence."));

    // Check Discord API was called ONLY for nickname, NOT for roles
    assert.equal(memberPatched, true);
    assert.equal(patchedNick, "LOA | AdminBoss");
    assert.equal(patchedRoles, null, "Roles must NOT be patched on Discord for Administrator");

    // Check DO record
    const created = [...doEntry.mockStorage.records.values()][0];
    assert.ok(created);
    assert.equal(created.is_protected_staff, 1);
    assert.equal(created.assigned_loa_role_id, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LOA HANDLER: Administrator returning early via button restores nickname without modifying roles", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const env = createMockEnvironment(pubHex, guildMap);
  const doEntry = createMockLoaDO(env);

  // Pre-seed an active protected LOA
  doEntry.instance.createLoa({
    id: "loa_admin_early",
    guildId: "guild_vital",
    userId: "admin_early_user",
    displayName: "AdminEarly",
    startDate: "2026-09-01",
    endDate: "2026-09-15",
    reason: "Vacation",
    todayIso: "2026-09-01",
  });
  // Mark as protected staff
  const rec = doEntry.mockStorage.records.get("loa_admin_early");
  rec.is_protected_staff = 1;
  rec.original_nickname = "AdminEarly";
  rec.loa_nickname = "LOA | AdminEarly";
  rec.nickname_modified = 1;
  rec.role_swap_status = "completed";

  guildMap.set("guild_vital", doEntry);

  let patchSent = false;
  let patchedNick = null;
  let patchedRoles = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/admin_early_user") && (options.method === "GET" || !options.method)) {
      return new Response(
        JSON.stringify({ nick: "LOA | AdminEarly", roles: [DEFAULT_ADMIN_ROLE_ID] }),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/admin_early_user") && options.method === "PATCH") {
      patchSent = true;
      const b = JSON.parse(options.body || "{}");
      if (b.nick !== undefined) patchedNick = b.nick;
      if (b.roles !== undefined) patchedRoles = b.roles;
      return new Response(JSON.stringify({ nick: patchedNick }), { status: 200 });
    }
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      return new Response(JSON.stringify({ id: "msg_admin_early" }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "LOA | AdminEarly",
        user: { id: "admin_early_user", username: "admin_early" },
        roles: [DEFAULT_ADMIN_ROLE_ID],
      },
      data: {
        custom_id: `${LoaCustomId.CONFIRM_RETURN_PREFIX}loa_admin_early`,
      },
    });

    const sig = await signDiscordPayload(body, keyPair, timestamp);
    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    assert.equal(res.status, 200);
    const json = await res.json();
    const text = getContainerTexts(json.data.components[0]);

    assert.ok(text.includes("Welcome back, I guess."));
    assert.ok(text.includes("Your Leave of Absence has ended early and your nickname has been restored. Welcome back!"));

    // Nickname restored, roles NOT patched
    assert.equal(patchSent, true);
    assert.equal(patchedNick, "AdminEarly");
    assert.equal(patchedRoles, null, "Roles must not be touched during early return for Administrator");

    // DO record updated
    const updated = doEntry.mockStorage.records.get("loa_admin_early");
    assert.equal(updated.ended_early, 1);
    assert.equal(updated.role_restore_status, "completed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CHANNEL ACCESS CONFIGURATION: Support Chat, Moderator Chat, and LOA Center role mappings", () => {
  const loaConfig = getLoaConfig();

  // Role IDs
  assert.equal(loaConfig.loaRoles.moderator, DEFAULT_LOA_MODERATOR_ROLE_ID);
  assert.equal(loaConfig.loaRoles.support, DEFAULT_LOA_SUPPORT_ROLE_ID);

  // Channels
  assert.equal(loaConfig.channels.supportChat, DEFAULT_SUPPORT_CHAT_CHANNEL_ID);
  assert.equal(loaConfig.channels.moderatorChat, DEFAULT_MODERATOR_CHAT_CHANNEL_ID);
  assert.equal(loaConfig.channels.loaCenter, "1546281163247722516");

  // hasStaffLoaRole helper
  assert.equal(hasStaffLoaRole([DEFAULT_LOA_MODERATOR_ROLE_ID]), true);
  assert.equal(hasStaffLoaRole([DEFAULT_LOA_SUPPORT_ROLE_ID]), true);
  assert.equal(hasStaffLoaRole([DEFAULT_ROLE_MEMBER]), false);
});

test("CRON ROLLOVER: Handles both protected leadership and regular staff expirations safely", async () => {
  const patchedUsers = [];

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/members/staff_reg_user") && options.method === "PATCH") {
      patchedUsers.push({ userId: "staff_reg_user", body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ roles: [DEFAULT_SUPPORT_STAFF_ROLE_ID] }), { status: 200 });
    }
    if (urlStr.includes("/members/staff_lead_user") && options.method === "PATCH") {
      patchedUsers.push({ userId: "staff_lead_user", body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ nick: "LeadUser" }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const env = {
    DISCORD_BOT_TOKEN: "mock_token",
    STAFF_LOA_ROLE_ID: DEFAULT_LOA_SUPPORT_ROLE_ID,
    LOA_LOG_CHANNEL_ID: DEFAULT_LOA_LOG_CHANNEL_ID,
  };

  const doEntry = createMockLoaDO(env);

  // 1. Regular staff completed LOA (needs role restore)
  doEntry.instance.createLoa({
    id: "loa_cron_reg",
    guildId: "guild_vital",
    userId: "staff_reg_user",
    displayName: "RegUser",
    startDate: "2026-08-20",
    endDate: "2026-09-06",
    reason: "Vacation",
    todayIso: "2026-08-20",
    removedRoleIds: [DEFAULT_SUPPORT_STAFF_ROLE_ID],
    roleSwapStatus: "completed",
  });

  // 2. Protected leadership completed LOA (is_protected_staff = 1)
  doEntry.instance.createLoa({
    id: "loa_cron_lead",
    guildId: "guild_vital",
    userId: "staff_lead_user",
    displayName: "LeadUser",
    startDate: "2026-08-20",
    endDate: "2026-09-06",
    reason: "Executive Leave",
    todayIso: "2026-08-20",
    removedRoleIds: [],
    roleSwapStatus: "completed",
  });
  const leadRec = doEntry.mockStorage.records.get("loa_cron_lead");
  leadRec.is_protected_staff = 1;

  const todayIso = "2026-09-07";
  await doEntry.instance.processCronRollover({
    env,
    todayIso,
    customFetch: mockCustomFetch,
  });

  const updatedReg = doEntry.instance.getLoaById("loa_cron_reg");
  assert.equal(updatedReg.role_restore_status, "completed");

  const updatedLead = doEntry.instance.getLoaById("loa_cron_lead");
  assert.equal(updatedLead.role_restore_status, "completed");

  // Regular user got roles patched
  const regPatch = patchedUsers.find((p) => p.userId === "staff_reg_user");
  assert.ok(regPatch);
  assert.ok(regPatch.body.roles.includes(DEFAULT_SUPPORT_STAFF_ROLE_ID));

  // Protected user got NO role patch
  const leadPatch = patchedUsers.find((p) => p.userId === "staff_lead_user");
  assert.ok(!leadPatch || !leadPatch.body.roles, "Protected user must not receive role patch in cron");
});

test("LEGACY & EXISTING ACTIVE LOAS: executeLoaRoleRestore handles legacy records with null is_protected_staff cleanly", async () => {
  let patchSent = false;
  let patchedRoles = null;

  const mockCustomFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/guilds/") && urlStr.includes("/roles")) {
      return new Response(
        JSON.stringify([
          { id: "bot_role", name: "Bot Role", position: 100 },
          { id: TEST_STAFF_ROLE_ID, name: "StaffTeam", position: 10 },
          { id: DEFAULT_ROLE_WHITELIST_APPROVED, name: "Whitelist Approved", position: 5 },
          { id: DEFAULT_LOA_MODERATOR_ROLE_ID, name: "LOA - Moderator", position: 9 },
          { id: DEFAULT_LOA_SUPPORT_ROLE_ID, name: "LOA - Support", position: 9 },
        ]),
        { status: 200 }
      );
    }
    if (urlStr.includes("/members/@me")) {
      return new Response(JSON.stringify({ roles: ["bot_role"] }), { status: 200 });
    }
    if (urlStr.includes("/members/legacy_user") && options.method === "PATCH") {
      patchSent = true;
      const b = JSON.parse(options.body);
      patchedRoles = b.roles;
      return new Response(JSON.stringify({ roles: patchedRoles }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const mockStub = {
    fetch: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
  };

  const legacyRecord = {
    id: "loa_legacy_1",
    removed_role_ids: [TEST_STAFF_ROLE_ID],
    is_protected_staff: null, // Legacy record before migration
    assigned_loa_role_id: null,
  };

  const res = await executeLoaRoleRestore({
    env: { DISCORD_BOT_TOKEN: "mock_token" },
    guildId: "guild_vital",
    userId: "legacy_user",
    currentMemberRoles: [DEFAULT_LOA_MODERATOR_ROLE_ID, DEFAULT_ROLE_WHITELIST_APPROVED],
    stub: mockStub,
    loaId: "loa_legacy_1",
    loaRecord: legacyRecord,
    customFetch: mockCustomFetch,
  });

  assert.equal(res.success, true);
  assert.equal(patchSent, true);
  assert.ok(patchedRoles.includes(TEST_STAFF_ROLE_ID));
  assert.ok(!patchedRoles.includes(DEFAULT_LOA_MODERATOR_ROLE_ID));
  assert.ok(!patchedRoles.includes(DEFAULT_LOA_SUPPORT_ROLE_ID));
});

// ============================================================================
// PERMANENT LOA DASHBOARD & REFRESH IN-PLACE BEHAVIOR (6 REQUIRED CASES)
// ============================================================================

test("CASE 1: Click Refresh once edits existing message via PATCH in place without posting new channel message", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  doEntry.instance.setMeta("last_list_message_id", "msg_permanent_dashboard_1");
  doEntry.instance.setMeta("last_list_channel_id", TEST_LOA_CHANNEL_ID);
  guildMap.set("guild_vital", doEntry);

  const env = createMockEnvironment(pubHex, guildMap);

  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      requests.push({ method: options.method || "GET", url: urlStr });
      if (options.method === "PATCH") {
        return new Response(JSON.stringify({ id: "msg_permanent_dashboard_1" }), { status: 200 });
      }
      if (options.method === "POST") {
        return new Response(JSON.stringify({ id: "msg_unexpected_post" }), { status: 200 });
      }
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_refresher_1" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: { custom_id: LoaCustomId.BTN_REFRESH },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    const json = await res.json();

    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.equal(json.data.content, "✅ Staff LOA Center refreshed.");

    // Verify: PATCH was called on the existing message ID
    const patchCalls = requests.filter((r) => r.method === "PATCH");
    const postCalls = requests.filter((r) => r.method === "POST");
    const deleteCalls = requests.filter((r) => r.method === "DELETE");

    assert.equal(patchCalls.length, 1, "Must call PATCH exactly once to update in place");
    assert.ok(patchCalls[0].url.endsWith("/msg_permanent_dashboard_1"), "PATCH must target existing dashboard message");
    assert.equal(postCalls.length, 0, "Must NOT send a new POST message to the LOA channel");
    assert.equal(deleteCalls.length, 0, "Must NOT delete the existing message");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CASE 2: Click Refresh multiple times continues updating the same dashboard message in place", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  doEntry.instance.setMeta("last_list_message_id", "msg_permanent_dashboard_multi");
  doEntry.instance.setMeta("last_list_channel_id", TEST_LOA_CHANNEL_ID);
  guildMap.set("guild_vital", doEntry);

  const env = createMockEnvironment(pubHex, guildMap);

  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      requests.push({ method: options.method || "GET", url: urlStr });
      if (options.method === "PATCH") {
        return new Response(JSON.stringify({ id: "msg_permanent_dashboard_multi" }), { status: 200 });
      }
    }
    return originalFetch(url, options);
  };

  try {
    for (let i = 0; i < 3; i++) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify({
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: "guild_vital",
        channel_id: TEST_LOA_CHANNEL_ID,
        member: {
          user: { id: "staff_refresher_multi" },
          roles: [TEST_STAFF_ROLE_ID],
        },
        data: { custom_id: LoaCustomId.BTN_REFRESH },
      });
      const sig = await signDiscordPayload(body, keyPair, timestamp);

      const req = new Request("https://damo-bot.local/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": sig,
          "x-signature-timestamp": timestamp,
        },
        body,
      });

      const res = await worker.fetch(req, env, {});
      const json = await res.json();
      assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
      assert.equal(json.data.content, "✅ Staff LOA Center refreshed.");
    }

    const patchCalls = requests.filter((r) => r.method === "PATCH");
    const postCalls = requests.filter((r) => r.method === "POST");
    const deleteCalls = requests.filter((r) => r.method === "DELETE");

    assert.equal(patchCalls.length, 3, "All 3 refreshes should call PATCH");
    for (const p of patchCalls) {
      assert.ok(p.url.endsWith("/msg_permanent_dashboard_multi"), "All PATCHes target the same message ID");
    }
    assert.equal(postCalls.length, 0, "Zero POST calls across multiple refreshes");
    assert.equal(deleteCalls.length, 0, "Zero DELETE calls across multiple refreshes");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CASE 3: Multiple staff members refreshing still updates the same single dashboard message", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  doEntry.instance.setMeta("last_list_message_id", "msg_permanent_dashboard_shared");
  doEntry.instance.setMeta("last_list_channel_id", TEST_LOA_CHANNEL_ID);
  guildMap.set("guild_vital", doEntry);

  const env = createMockEnvironment(pubHex, guildMap);

  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      requests.push({ method: options.method || "GET", url: urlStr });
      if (options.method === "PATCH") {
        return new Response(JSON.stringify({ id: "msg_permanent_dashboard_shared" }), { status: 200 });
      }
    }
    return originalFetch(url, options);
  };

  try {
    const staffMembers = ["staff_alice", "staff_bob", "staff_charlie"];
    for (const staffId of staffMembers) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify({
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: "guild_vital",
        channel_id: TEST_LOA_CHANNEL_ID,
        member: {
          user: { id: staffId },
          roles: [TEST_STAFF_ROLE_ID],
        },
        data: { custom_id: LoaCustomId.BTN_REFRESH },
      });
      const sig = await signDiscordPayload(body, keyPair, timestamp);

      const req = new Request("https://damo-bot.local/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": sig,
          "x-signature-timestamp": timestamp,
        },
        body,
      });

      const res = await worker.fetch(req, env, {});
      const json = await res.json();
      assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
      assert.equal(json.data.content, "✅ Staff LOA Center refreshed.");
    }

    const patchCalls = requests.filter((r) => r.method === "PATCH");
    const postCalls = requests.filter((r) => r.method === "POST");

    assert.equal(patchCalls.length, 3, "Each staff member triggered a PATCH");
    for (const p of patchCalls) {
      assert.ok(p.url.endsWith("/msg_permanent_dashboard_shared"), "All users patch the same single dashboard message");
    }
    assert.equal(postCalls.length, 0, "No new messages created by multiple staff members");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CASE 4: Submit a real new LOA keeps normal new-LOA notification and audit logging intact", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  guildMap.set("guild_vital", doEntry);

  const env = createMockEnvironment(pubHex, guildMap);

  const originalFetch = globalThis.fetch;
  const postedMessages = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages") && options.method === "POST") {
      postedMessages.push({ url: urlStr, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ id: `msg_new_loa_${Date.now()}` }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    const today = getTodayInChicago();
    const [y, m, d] = today.split("-").map(Number);
    const startStr = today;
    const endStr = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
    const [sy, sm, sd] = startStr.split("-");
    const [ey, em, ed] = endStr.split("-");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.APPLICATION_COMMAND,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        nick: "Officer Damo",
        user: { id: "staff_real_submitter" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: {
        name: "loa",
        options: [
          {
            name: "start",
            options: [
              { name: "start_date", value: `${sm}/${sd}/${sy}` },
              { name: "end_date", value: `${em}/${ed}/${ey}` },
              { name: "reason", value: "Real family vacation" },
            ],
          },
        ],
      },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, env, {});
    const json = await res.json();

    assert.equal(json.data.flags, EPHEMERAL_FLAG | IS_COMPONENTS_V2_FLAG);
    const text = getContainerTexts(json.data.components[0]);
    assert.ok(text.includes("# 🏖️ Leave of Absence Submitted"));
    assert.ok(text.includes("Real family vacation"));

    // Check that audit log was dispatched to LOA logs channel
    const logCall = postedMessages.find((m) => m.url.includes(DEFAULT_LOA_LOG_CHANNEL_ID));
    assert.ok(logCall, "Normal new-LOA audit log was posted to LOA logs channel");

    // Check DO storage recorded the LOA
    const activeLoas = doEntry.instance.getActiveLoasList(today);
    assert.equal(activeLoas.length, 1);
    assert.equal(activeLoas[0].reason, "Real family vacation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CASE 5: Restart Damo-bot finds and reuses existing dashboard message from persistent storage", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  // Simulate persistent SQLite storage in DO surviving a restart
  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  doEntry.instance.setMeta("last_list_message_id", "msg_persisted_across_restart");
  doEntry.instance.setMeta("last_list_channel_id", TEST_LOA_CHANNEL_ID);
  guildMap.set("guild_vital", doEntry);

  // Restart Worker instance (new env instance simulating worker isolate restart)
  const restartedEnv = createMockEnvironment(pubHex, guildMap);

  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      requests.push({ method: options.method || "GET", url: urlStr });
      if (options.method === "PATCH") {
        return new Response(JSON.stringify({ id: "msg_persisted_across_restart" }), { status: 200 });
      }
    }
    return originalFetch(url, options);
  };

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_after_restart" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: { custom_id: LoaCustomId.BTN_REFRESH },
    });
    const sig = await signDiscordPayload(body, keyPair, timestamp);

    const req = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig,
        "x-signature-timestamp": timestamp,
      },
      body,
    });

    const res = await worker.fetch(req, restartedEnv, {});
    const json = await res.json();
    assert.equal(json.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.equal(json.data.content, "✅ Staff LOA Center refreshed.");

    const patchCalls = requests.filter((r) => r.method === "PATCH");
    const postCalls = requests.filter((r) => r.method === "POST");

    assert.equal(patchCalls.length, 1, "PATCH called using persisted message ID");
    assert.ok(patchCalls[0].url.endsWith("/msg_persisted_across_restart"), "Targeted exact persisted message ID");
    assert.equal(postCalls.length, 0, "No duplicate message created after restart");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CASE 6: Delete dashboard manually, then refresh safely recreates replacement and saves new message ID", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  doEntry.instance.setMeta("last_list_message_id", "msg_manually_deleted");
  doEntry.instance.setMeta("last_list_channel_id", TEST_LOA_CHANNEL_ID);
  guildMap.set("guild_vital", doEntry);

  const env = createMockEnvironment(pubHex, guildMap);

  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes("/channels/") && urlStr.includes("/messages")) {
      requests.push({ method: options.method || "GET", url: urlStr });
      // 1. Manually deleted message returns 404 on PATCH
      if (options.method === "PATCH" && urlStr.endsWith("/msg_manually_deleted")) {
        return new Response(JSON.stringify({ code: 10008, message: "Unknown Message" }), { status: 404 });
      }
      // 2. Replacement message is posted via POST
      if (options.method === "POST") {
        return new Response(JSON.stringify({ id: "msg_recreated_replacement_99" }), { status: 200 });
      }
      // 3. Subsequent PATCH to replacement message succeeds
      if (options.method === "PATCH" && urlStr.endsWith("/msg_recreated_replacement_99")) {
        return new Response(JSON.stringify({ id: "msg_recreated_replacement_99" }), { status: 200 });
      }
    }
    return originalFetch(url, options);
  };

  try {
    // 1st Refresh: detects 404 and creates replacement
    const timestamp1 = Math.floor(Date.now() / 1000).toString();
    const body1 = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_recovery" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: { custom_id: LoaCustomId.BTN_REFRESH },
    });
    const sig1 = await signDiscordPayload(body1, keyPair, timestamp1);

    const req1 = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig1,
        "x-signature-timestamp": timestamp1,
      },
      body: body1,
    });

    const res1 = await worker.fetch(req1, env, {});
    const json1 = await res1.json();
    assert.equal(json1.data.flags, InteractionResponseFlags.EPHEMERAL);
    assert.equal(json1.data.content, "✅ Staff LOA Center refreshed.");

    // Verify 404 was handled: 1 PATCH attempt on old message, 1 POST for replacement
    const postCalls1 = requests.filter((r) => r.method === "POST");
    assert.equal(postCalls1.length, 1, "Replacement message posted upon 404");

    // Verify new message ID was saved in DO persistent metadata
    assert.equal(
      doEntry.instance.getMeta("last_list_message_id"),
      "msg_recreated_replacement_99",
      "New replacement message ID saved in storage"
    );

    // 2nd Refresh: should now PATCH the newly created replacement message in place without POSTing
    requests.length = 0;
    const timestamp2 = Math.floor(Date.now() / 1000).toString();
    const body2 = JSON.stringify({
      type: InteractionType.MESSAGE_COMPONENT,
      guild_id: "guild_vital",
      channel_id: TEST_LOA_CHANNEL_ID,
      member: {
        user: { id: "staff_recovery_2" },
        roles: [TEST_STAFF_ROLE_ID],
      },
      data: { custom_id: LoaCustomId.BTN_REFRESH },
    });
    const sig2 = await signDiscordPayload(body2, keyPair, timestamp2);

    const req2 = new Request("https://damo-bot.local/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": sig2,
        "x-signature-timestamp": timestamp2,
      },
      body: body2,
    });

    const res2 = await worker.fetch(req2, env, {});
    const json2 = await res2.json();
    assert.equal(json2.data.flags, InteractionResponseFlags.EPHEMERAL);

    const patchCalls2 = requests.filter((r) => r.method === "PATCH");
    const postCalls2 = requests.filter((r) => r.method === "POST");
    assert.equal(postCalls2.length, 0, "No additional POST request made");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// ENHANCED LOA CENTER TESTS
// ============================================================================

test("ENHANCED LOA: Extend LOA modal updates return date, preserves original date, resets reminder flag", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  guildMap.set("guild_vital", doEntry);
  const env = createMockEnvironment(pubHex, guildMap);

  // Create an active LOA
  doEntry.instance.createLoa({
    id: "loa_ext_test_1",
    guildId: "guild_vital",
    userId: "staff_ext_user",
    displayName: "ExtUser",
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    reason: "Original reason",
    todayIso: "2026-09-05",
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MODAL_SUBMIT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_ext_user", username: "extuser" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: {
      custom_id: `${LoaCustomId.MODAL_EXTEND_PREFIX}loa_ext_test_1`,
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: "new_end_date",
              value: "9/25/2026",
            },
          ],
        },
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: "reason",
              value: "Extended due to family travel",
            },
          ],
        },
      ],
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  const text = getContainerTexts(json.data.components[0]);
  assert.ok(text.includes("Leave of Absence Extended"));

  // Verify DO record state
  const updated = doEntry.instance.getLoaById("loa_ext_test_1");
  assert.equal(updated.end_date, "2026-09-25");
  assert.equal(updated.original_expected_return_date, "2026-09-10");
  assert.equal(updated.reason, "Extended due to family travel");
  assert.equal(updated.reminder_sent, 0);
  assert.ok(Array.isArray(updated.extensionHistory));
  assert.equal(updated.extensionHistory.length, 1);
  assert.equal(updated.extensionHistory[0].previousEndDate, "2026-09-10");
  assert.equal(updated.extensionHistory[0].newEndDate, "2026-09-25");
});

test("ENHANCED LOA: Edit Reason modal updates reason and appends to reason history", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  guildMap.set("guild_vital", doEntry);
  const env = createMockEnvironment(pubHex, guildMap);

  doEntry.instance.createLoa({
    id: "loa_edit_reason_1",
    guildId: "guild_vital",
    userId: "staff_edit_user",
    displayName: "EditUser",
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    reason: "First reason",
    todayIso: "2026-09-05",
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MODAL_SUBMIT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_edit_user", username: "edituser" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: {
      custom_id: `${LoaCustomId.MODAL_EDIT_REASON_PREFIX}loa_edit_reason_1`,
      components: [
        {
          type: ComponentType.ACTION_ROW,
          components: [
            {
              type: ComponentType.TEXT_INPUT,
              custom_id: "reason",
              value: "Updated reason for leave",
            },
          ],
        },
      ],
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  const text = getContainerTexts(json.data.components[0]);
  assert.ok(text.includes("LOA Reason Updated"));

  const updated = doEntry.instance.getLoaById("loa_edit_reason_1");
  assert.equal(updated.reason, "Updated reason for leave");
  assert.ok(Array.isArray(updated.reasonHistory));
  assert.equal(updated.reasonHistory.length, 1);
  assert.equal(updated.reasonHistory[0].previousReason, "First reason");
  assert.equal(updated.reasonHistory[0].newReason, "Updated reason for leave");
});

test("ENHANCED LOA: Return Early restores roles, sets return_type = 'EARLY_RETURN', and is idempotent", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  guildMap.set("guild_vital", doEntry);
  const env = createMockEnvironment(pubHex, guildMap);

  // Create active LOA with role snapshot
  doEntry.instance.createLoa({
    id: "loa_return_early_1",
    guildId: "guild_vital",
    userId: "staff_early_user",
    displayName: "EarlyUser",
    startDate: "2026-09-01",
    endDate: "2026-09-15",
    reason: "Trip",
    todayIso: "2026-09-05",
  });
  doEntry.instance.updateLoaRoleSnapshot("loa_return_early_1", {
    removedRoleIds: [DEFAULT_MODERATOR_ROLE_ID],
    preservedRoleIds: [TEST_STAFF_ROLE_ID],
    assignedLoaRoleId: DEFAULT_STAFF_LOA_ROLE_ID,
    isProtectedStaff: false,
    roleSwapStatus: "completed",
  });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_early_user", username: "earlyuser" },
      roles: [DEFAULT_STAFF_LOA_ROLE_ID],
    },
    data: {
      custom_id: `${LoaCustomId.CONFIRM_RETURN_PREFIX}loa_return_early_1`,
    },
  });

  const sig = await signDiscordPayload(body, keyPair, timestamp);
  const req = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig,
      "x-signature-timestamp": timestamp,
    },
    body,
  });

  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const json = await res.json();
  const text = getContainerTexts(json.data.components[0]);
  assert.ok(text.includes("Welcome Back"));

  const updated = doEntry.instance.getLoaById("loa_return_early_1");
  assert.equal(updated.ended_early, 1);
  assert.equal(updated.return_type, "EARLY_RETURN");
  assert.ok(updated.actual_return_at != null);

  // Idempotency: clicking again rejects
  const bodyAgain = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "staff_early_user", username: "earlyuser" },
      roles: [TEST_STAFF_ROLE_ID],
    },
    data: {
      custom_id: `${LoaCustomId.CONFIRM_RETURN_PREFIX}loa_return_early_1`,
    },
  });
  const sigAgain = await signDiscordPayload(bodyAgain, keyPair, timestamp);
  const req2 = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sigAgain,
      "x-signature-timestamp": timestamp,
    },
    body: bodyAgain,
  });
  const res2 = await worker.fetch(req2, env, {});
  const json2 = await res2.json();
  assert.ok(json2.data.content.includes("already ended"));
});

test("ENHANCED LOA: Overdue LOAs display 🔴 OVERDUE and remain active until ended", () => {
  const todayIso = "2026-09-25";
  const loas = [
    {
      id: "overdue_1",
      display_name: "OverdueStaff",
      start_date: "2026-09-01",
      end_date: "2026-09-10", // in the past!
      reason: "Exam study",
      ended_at: null,
      ended_early: 0,
      cancelled: 0,
      role_swap_status: "completed",
    },
  ];

  const containers = buildLoaListContainers(loas, null, todayIso);
  const text = getContainerTexts(containers[0]);
  assert.ok(text.includes("OVERDUE"));
  assert.ok(text.includes("🔴"));
  assert.ok(text.includes("OverdueStaff"));
});

test("ENHANCED LOA: Admin can view active LOAs dashboard, inspect target, and end LOA", async () => {
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const rawPub = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const pubHex = Buffer.from(rawPub).toString("hex");

  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  guildMap.set("guild_vital", doEntry);
  const env = createMockEnvironment(pubHex, guildMap);

  doEntry.instance.createLoa({
    id: "loa_admin_target_1",
    guildId: "guild_vital",
    userId: "staff_target_1",
    displayName: "TargetStaff",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    reason: "Leave",
    todayIso: "2026-09-05",
  });
  doEntry.instance.updateLoaRoleSnapshot("loa_admin_target_1", {
    removedRoleIds: [DEFAULT_MODERATOR_ROLE_ID],
    preservedRoleIds: [TEST_STAFF_ROLE_ID],
    assignedLoaRoleId: DEFAULT_STAFF_LOA_ROLE_ID,
    isProtectedStaff: false,
    roleSwapStatus: "completed",
  });

  // 1. Click View Active LOAs button as Management
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body1 = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "mgr_1", username: "mgr" },
      roles: [DEFAULT_VRP_MANAGEMENT_ROLE_ID],
    },
    data: { custom_id: LoaCustomId.BTN_ACTIVE },
  });

  const sig1 = await signDiscordPayload(body1, keyPair, timestamp);
  const req1 = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig1,
      "x-signature-timestamp": timestamp,
    },
    body: body1,
  });

  const res1 = await worker.fetch(req1, env, {});
  const json1 = await res1.json();
  const text1 = getContainerTexts(json1.data.components[0]);
  assert.ok(text1.includes("Active Staff LOAs"));
  assert.ok(text1.includes("TargetStaff"));

  // 2. Select the staff member from dropdown
  const body2 = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "mgr_1", username: "mgr" },
      roles: [DEFAULT_VRP_MANAGEMENT_ROLE_ID],
    },
    data: {
      custom_id: LoaCustomId.SELECT_ADMIN_TARGET,
      values: ["loa_admin_target_1"],
    },
  });

  const sig2 = await signDiscordPayload(body2, keyPair, timestamp);
  const req2 = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig2,
      "x-signature-timestamp": timestamp,
    },
    body: body2,
  });

  const res2 = await worker.fetch(req2, env, {});
  const json2 = await res2.json();
  const text2 = getContainerTexts(json2.data.components[0]);
  assert.ok(text2.includes("LOA Admin Details"));

  // 3. Confirm admin end LOA
  const body3 = JSON.stringify({
    type: InteractionType.MESSAGE_COMPONENT,
    guild_id: "guild_vital",
    channel_id: TEST_LOA_CHANNEL_ID,
    member: {
      user: { id: "mgr_1", username: "mgr" },
      roles: [DEFAULT_VRP_MANAGEMENT_ROLE_ID],
    },
    data: {
      custom_id: `${LoaCustomId.CONFIRM_ADMIN_END_PREFIX}loa_admin_target_1`,
    },
  });

  const sig3 = await signDiscordPayload(body3, keyPair, timestamp);
  const req3 = new Request("https://damo-bot.local/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": sig3,
      "x-signature-timestamp": timestamp,
    },
    body: body3,
  });

  const res3 = await worker.fetch(req3, env, {});
  const json3 = await res3.json();
  const text3 = getContainerTexts(json3.data.components[0]);
  assert.ok(text3.includes("LOA Ended by Administrator"));

  const updated = doEntry.instance.getLoaById("loa_admin_target_1");
  assert.equal(updated.return_type, "ADMIN_ENDED");
  assert.equal(updated.modified_by, "mgr_1");
});

test("ENHANCED LOA: 24-Hour Return Reminder dispatches DM and sets reminder_sent flag", async () => {
  const pubHex = "aabbcc";
  const guildMap = new Map();
  const doEntry = createMockLoaDO();
  guildMap.set("guild_vital", doEntry);
  const env = createMockEnvironment(pubHex, guildMap);

  // Create an active LOA ending tomorrow (2026-09-06) relative to today (2026-09-05)
  doEntry.instance.createLoa({
    id: "loa_rem_1",
    guildId: "guild_vital",
    userId: "staff_rem_1",
    displayName: "ReminderStaff",
    startDate: "2026-09-01",
    endDate: "2026-09-06",
    reason: "Vacation",
    todayIso: "2026-09-05",
  });

  let reminderDMDelivered = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes("/users/@me/channels")) {
      return new Response(JSON.stringify({ id: "dm_chan_123" }), { status: 200 });
    }
    if (urlStr.includes("/channels/dm_chan_123/messages")) {
      reminderDMDelivered = true;
      return new Response(JSON.stringify({ id: "msg_dm_123" }), { status: 200 });
    }
    return originalFetch(url, opts);
  };

  try {
    const rolloverResult = await doEntry.instance.processCronRollover({
      env,
      todayIso: "2026-09-05",
      guildId: "guild_vital",
    });

    assert.equal(rolloverResult.remindersSent, 1);
    assert.equal(reminderDMDelivered, true);

    // Verify reminder_sent = 1
    const rec = doEntry.instance.getLoaById("loa_rem_1");
    assert.equal(rec.reminder_sent, 1);

    // Running again does NOT send duplicate reminder
    reminderDMDelivered = false;
    const rolloverResult2 = await doEntry.instance.processCronRollover({
      env,
      todayIso: "2026-09-05",
      guildId: "guild_vital",
    });
    assert.equal(rolloverResult2.remindersSent, 0);
    assert.equal(reminderDMDelivered, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});









