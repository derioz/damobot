/**
 * Discord Nickname Management Utilities for Staff LOA.
 *
 * Rules:
 * - Prefix: "LOA | " (exact, including trailing space).
 * - Max length: 32 characters (Discord official nickname limit).
 * - Unicode grapheme cluster safe truncation.
 * - Idempotent formatting (never "LOA | LOA | ").
 * - Safe restoration considering manual nickname changes during LOA.
 */

export const NICKNAME_PREFIX = "LOA | ";
export const MAX_NICKNAME_LENGTH = 32;

/**
 * Truncate a string to a maximum string length without breaking Unicode grapheme clusters or surrogate pairs.
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
export function truncateGraphemes(str, maxLength) {
  if (!str || typeof str !== "string") return "";
  if (maxLength <= 0) return "";

  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    let result = "";
    for (const { segment } of segmenter.segment(str)) {
      if (result.length + segment.length > maxLength) {
        break;
      }
      result += segment;
    }
    return result;
  }

  // Fallback: iterate code points via Array.from
  let result = "";
  for (const char of Array.from(str)) {
    if (result.length + char.length > maxLength) {
      break;
    }
    result += char;
  }
  return result;
}

/**
 * Check if a nickname already starts with "LOA | ".
 * @param {string|null} nickname
 * @returns {boolean}
 */
export function hasLoaPrefix(nickname) {
  if (!nickname || typeof nickname !== "string") return false;
  return nickname.startsWith(NICKNAME_PREFIX);
}

/**
 * Strip leading LOA prefix from a nickname or display name if present.
 * Supports standard "LOA | " as well as manual variants like "LOA || " and multi-bar prefixes.
 * Does NOT strip "LOA" if it appears naturally elsewhere in a person's name (e.g. "Jonsey LOA").
 *
 * @param {string|null} nickname
 * @returns {string}
 */
export function stripLoaPrefix(nickname) {
  if (!nickname || typeof nickname !== "string") return nickname || "";
  return nickname.replace(/^(\s*LOA\s*\|{1,}\s*)+/i, "").trim();
}

/**
 * Format a nickname with the "LOA | " prefix, truncating base safely if needed to respect 32-char limit.
 * Idempotent: if already has "LOA | ", returns as is without double-prefixing.
 *
 * @param {string} baseNickname
 * @returns {string}
 */
export function formatLoaNickname(baseNickname) {
  if (!baseNickname || typeof baseNickname !== "string") {
    return NICKNAME_PREFIX.trim();
  }

  const trimmed = baseNickname.trim();
  if (hasLoaPrefix(trimmed)) {
    return trimmed;
  }

  const maxBaseLength = MAX_NICKNAME_LENGTH - NICKNAME_PREFIX.length; // 26
  const truncatedBase = truncateGraphemes(trimmed, maxBaseLength);
  return `${NICKNAME_PREFIX}${truncatedBase}`;
}

/**
 * Compute the restored nickname when an LOA ends or returns early.
 *
 * Logic:
 * 1. If currentNickname matches the exact LOA nickname applied by Damo Bot:
 *    Restore originalNickname (string or null).
 * 2. If currentNickname is different from loaNickname but still starts with "LOA | ":
 *    The member or an admin changed their nickname while on LOA (e.g. "LOA | Big Damon").
 *    Do NOT overwrite with stale originalNickname; strip only "LOA | " to preserve the manual change.
 * 3. If currentNickname does not start with "LOA | ":
 *    The prefix was already removed or manually modified; leave currentNickname as is.
 *
 * @param {Object} params
 * @param {string|null} params.currentNickname - Current nickname in Discord server
 * @param {string|null} params.originalNickname - Nickname before LOA was activated (null if none)
 * @param {string|null} params.loaNickname - The nickname Damo Bot set when activating LOA
 * @returns {string|null}
 */
export function computeRestoredNickname({
  currentNickname,
  originalNickname,
  loaNickname,
}) {
  // If current matches what Damo Bot set, restore original
  if (currentNickname === loaNickname) {
    return originalNickname != null && originalNickname !== ""
      ? originalNickname
      : null;
  }

  // If current differs but still begins with "LOA | ", strip only the prefix
  if (hasLoaPrefix(currentNickname)) {
    const stripped = stripLoaPrefix(currentNickname).trim();
    return stripped || null;
  }

  // Otherwise, leave current nickname as is
  return currentNickname != null && currentNickname !== ""
    ? currentNickname
    : null;
}

/**
 * Call Discord Modify Guild Member REST API to update member nickname.
 *
 * Endpoint: PATCH /guilds/{guild.id}/members/{user.id}
 * Requires: MANAGE_NICKNAMES permission and role hierarchy.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {string|null} options.newNickname - New nickname string, or null to remove override
 * @param {string} [options.reason="Staff LOA status update"]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{ success: boolean, status: number, error?: string }>}
 */
export async function modifyGuildMemberNickname({
  env,
  guildId,
  userId,
  newNickname,
  reason = "Staff LOA status update",
  customFetch = fetch,
}) {
  if (!env?.DISCORD_BOT_TOKEN) {
    return { success: false, status: 0, error: "Missing DISCORD_BOT_TOKEN" };
  }
  if (!guildId || !userId) {
    return { success: false, status: 0, error: "Missing guildId or userId" };
  }

  const url = `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`;
  try {
    const res = await customFetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
        "X-Audit-Log-Reason": reason,
      },
      body: JSON.stringify({
        nick: newNickname === undefined ? null : newNickname,
      }),
    });

    if (res.ok) {
      return { success: true, status: res.status };
    }

    const errText = await res.text();
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.warn(`Discord modify nickname failed (${res.status}):`, errText);
    }
    return { success: false, status: res.status, error: errText };
  } catch (err) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.warn("Exception modifying Discord nickname:", err?.message || err);
    }
    return {
      success: false,
      status: 0,
      error: err?.message || "Internal error",
    };
  }
}

/**
 * Fetch current guild member details from Discord REST API.
 * Endpoint: GET /guilds/{guild.id}/members/{user.id}
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{ success: boolean, status: number, member?: Object, error?: string }>}
 */
export async function getGuildMember({
  env,
  guildId,
  userId,
  customFetch = fetch,
}) {
  if (!env?.DISCORD_BOT_TOKEN) {
    return { success: false, status: 0, error: "Missing DISCORD_BOT_TOKEN" };
  }
  if (!guildId || !userId) {
    return { success: false, status: 0, error: "Missing guildId or userId" };
  }

  const url = `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`;
  try {
    const res = await customFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
    });

    if (res.ok) {
      const member = await res.json();
      return { success: true, status: res.status, member };
    }

    const errText = await res.text();
    console.warn(`Discord get member failed (${res.status}):`, errText);
    return { success: false, status: res.status, error: errText };
  } catch (err) {
    console.warn("Exception fetching Discord member:", err?.message || err);
    return {
      success: false,
      status: 0,
      error: err?.message || "Internal error",
    };
  }
}
