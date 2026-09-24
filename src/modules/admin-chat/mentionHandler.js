/**
 * Admin Chat Direct Mention Easter-Egg Handler.
 *
 * Responds with random sarcastic, witty, or funny messages when an Admin
 * directly @mentions Damo-bot inside the Admin Chat channel.
 */

import { DEFAULT_ADMIN_CHAT_CHANNEL_ID } from "../../config/channels.js";
import {
  DEFAULT_ADMINISTRATOR_ROLE_ID,
  DEFAULT_ADMIN_ROLE_ID,
  DEFAULT_SENIOR_ADMINISTRATOR_ROLE_ID,
  DEFAULT_HEAD_ADMINISTRATOR_ROLE_ID,
  DEFAULT_VRP_MANAGEMENT_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  DEFAULT_HEAD_OF_STAFF_ROLE_ID,
} from "../../config/roles.js";
import { isSuperadmin, hasAnyRole, extractMemberRoles } from "../../config/helpers.js";
import { sendDiscordChannelMessage } from "../../shared/discord.js";
import { getRandomAdminResponse } from "../../config/adminChatResponses.js";

// Cooldown duration: 5 seconds per user
export const ADMIN_CHAT_COOLDOWN_MS = 5000;

// In-memory cooldown storage (userId -> timestamp)
const userCooldowns = new Map();

/**
 * Check if a user is currently on cooldown.
 *
 * @param {string} userId
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function isUserOnCooldown(userId, now = Date.now()) {
  if (!userId) return false;
  const lastTime = userCooldowns.get(userId);
  if (lastTime && now - lastTime < ADMIN_CHAT_COOLDOWN_MS) {
    return true;
  }
  return false;
}

/**
 * Record a user's mention timestamp for cooldown tracking.
 *
 * @param {string} userId
 * @param {number} [now=Date.now()]
 */
export function recordUserCooldown(userId, now = Date.now()) {
  if (!userId) return;
  userCooldowns.set(userId, now);

  // Prune expired cooldowns when Map size exceeds 100 entries
  if (userCooldowns.size > 100) {
    for (const [id, ts] of userCooldowns.entries()) {
      if (now - ts > ADMIN_CHAT_COOLDOWN_MS * 2) {
        userCooldowns.delete(id);
      }
    }
  }
}

/**
 * Clear in-memory cooldowns (useful for unit tests).
 */
export function resetCooldowns() {
  userCooldowns.clear();
}

/**
 * Resolve Damo-bot's Discord application/bot user ID.
 *
 * @param {Object} [env={}]
 * @returns {string}
 */
export function getBotId(env = {}) {
  return String(
    env.DISCORD_BOT_ID || env.DISCORD_APPLICATION_ID || "1544164852132618382"
  ).trim();
}

/**
 * Check if a message is a DIRECT user mention of Damo-bot.
 *
 * Requirements:
 * - Must directly mention Damo-bot (<@botId> or <@!botId>).
 * - Must NOT trigger from @everyone, @here, role mentions (<@&roleId>),
 *   plain text "Damo" without an actual bot ping, or replies that do not
 *   explicitly contain a direct mention tag in message text.
 *
 * @param {Object} message Discord message payload
 * @param {string} botId Damo-bot user ID
 * @returns {boolean}
 */
export function isDirectBotMention(message, botId) {
  if (!message || !botId) return false;

  // 1. Exclude @everyone / @here
  if (message.mention_everyone) {
    return false;
  }

  // 2. Must have mentions array containing the bot's user ID
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const hasBotInMentions = mentions.some((u) => String(u?.id || u) === String(botId));
  if (!hasBotInMentions) {
    return false;
  }

  // 3. Content must contain an explicit mention tag (<@botId> or <@!botId>)
  // This satisfies Step 5: recognizing @Damo-bot while excluding replies without explicit mention.
  const content = String(message.content || "");
  const directMentionRegex = new RegExp(`<@!?${botId}>`);
  if (!directMentionRegex.test(content)) {
    return false;
  }

  return true;
}

/**
 * Verify whether the message author has the Admin role or Administrator permissions.
 * Reuses existing Damo-bot Admin role configurations.
 *
 * @param {Object} message Discord message payload
 * @param {Object} [env={}] Worker environment
 * @returns {boolean}
 */
export function hasAdminRole(message, env = {}) {
  if (!message) return false;

  // 1. Check Superadmin bypass
  if (isSuperadmin(message)) {
    return true;
  }

  // 2. Check Discord native Administrator permission bit (0x8)
  if (message.member?.permissions) {
    try {
      const perms = BigInt(message.member.permissions);
      if ((perms & 8n) === 8n) return true;
    } catch {}
  }

  // 3. Check existing configured Administrator / Leadership roles
  const adminRoles = [
    env.ADMINISTRATOR_ROLE_ID || DEFAULT_ADMINISTRATOR_ROLE_ID,
    env.ADMIN_ROLE_ID || DEFAULT_ADMIN_ROLE_ID,
    env.SENIOR_ADMINISTRATOR_ROLE_ID || DEFAULT_SENIOR_ADMINISTRATOR_ROLE_ID,
    env.HEAD_ADMINISTRATOR_ROLE_ID || DEFAULT_HEAD_ADMINISTRATOR_ROLE_ID,
    env.VRP_MANAGEMENT_ROLE_ID || DEFAULT_VRP_MANAGEMENT_ROLE_ID,
    env.OWNER_ROLE_ID || DEFAULT_OWNER_ROLE_ID,
    env.HEAD_OF_STAFF_ROLE_ID || DEFAULT_HEAD_OF_STAFF_ROLE_ID,
  ].filter(Boolean);

  return hasAnyRole(message, adminRoles);
}

/**
 * Process an incoming message and trigger Damo-bot's sarcastic reply if all criteria pass.
 *
 * @param {Object} message Discord message object
 * @param {Object} [env={}] Cloudflare Worker environment
 * @param {Function} [customFetch=fetch] Custom fetch implementation for testing
 * @returns {Promise<{ handled: boolean, reason?: string, response?: string }>}
 */
export async function handleAdminChatMessage(message, env = {}, customFetch = fetch) {
  if (!message) {
    return { handled: false, reason: "no_message" };
  }

  const botId = getBotId(env);
  const adminChatChannelId = String(
    env.ADMIN_CHAT_CHANNEL_ID || DEFAULT_ADMIN_CHAT_CHANNEL_ID
  ).trim();
  const channelId = String(message.channel_id || "").trim();
  const author = message.author || {};
  const authorId = String(author.id || "").trim();
  const isCorrectChannel = (channelId === adminChatChannelId);
  const directMention = isDirectBotMention(message, botId);
  const adminCheck = hasAdminRole(message, env);
  const cooldownActive = isUserOnCooldown(authorId);

  const isDebug = env.ADMIN_CHAT_DEBUG_TEST === "true" || env.DEBUG === "true";

  if (isDebug) {
    // Step 1: Log incoming message
    console.log("MESSAGE_CREATE RECEIVED");
    console.log("channelId:", channelId);
    console.log("authorId:", authorId);
    console.log("authorBot:", Boolean(author.bot));
    console.log("content:", message.content || "");
    console.log("mentions bot:", directMention);

    // Step 4: Trace existing mention handler
    console.log("Admin mention handler reached");
    console.log("Correct channel:", isCorrectChannel);
    console.log("Direct bot mention:", directMention);
    console.log("Admin role found:", adminCheck);
    console.log("Cooldown active:", cooldownActive);

    // Step 6: Verify Admin role detection
    const configuredAdminRoleId = env.ADMIN_ROLE_ID || env.ADMINISTRATOR_ROLE_ID || DEFAULT_ADMINISTRATOR_ROLE_ID;
    const memberRoleIds = extractMemberRoles(message);
    console.log("configuredAdminRoleId:", configuredAdminRoleId);
    console.log("memberRoleIds:", memberRoleIds);
    console.log("hasAdminRole:", adminCheck);
  }

  // 1. Channel check
  if (!isCorrectChannel) {
    return { handled: false, reason: "not_admin_chat" };
  }

  // 2. Author bot / self check
  if (author.bot) {
    return { handled: false, reason: "author_is_bot" };
  }
  if (author.id && String(author.id) === String(botId)) {
    return { handled: false, reason: "author_is_self" };
  }

  // 3. Direct mention check
  if (!directMention) {
    return { handled: false, reason: "not_direct_bot_mention" };
  }

  // 4. STEP 7 TEMPORARY DEBUG TEST MODE:
  // If ADMIN_CHAT_DEBUG_TEST is enabled, reply "mention test works" immediately
  // before checking Admin role or cooldown.
  if (env.ADMIN_CHAT_DEBUG_TEST === "true") {
    console.log("Attempting reply: true (Step 7 temporary test mode)");
    try {
      const testResponseText = "mention test works";
      console.log(`[Admin Chat Reply] Sending to channel ${channelId}, referencing message ${message.id}...`);
      const res = await sendDiscordChannelMessage({
        channelId,
        env,
        content: testResponseText,
        message_reference: {
          message_id: message.id,
          channel_id: channelId,
          fail_if_not_exists: false,
        },
        allowed_mentions: {
          replied_user: false,
          parse: [],
        },
        customFetch,
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Discord API Reply Error (Status ${res.status}):`, errText);
        return { handled: false, reason: "api_error", status: res.status, error: errText };
      }

      console.log("[Admin Chat Reply] Message posted successfully!");
      return { handled: true, response: testResponseText };
    } catch (err) {
      console.error("Discord API Network/Execution Error:", err?.message || err);
      return { handled: false, reason: "send_failed", error: err?.message || err };
    }
  }

  // 5. Admin role check
  if (!adminCheck) {
    if (isDebug) console.log("Mention rejected: author lacks Admin role");
    return { handled: false, reason: "not_admin_role" };
  }

  // 6. Anti-spam cooldown check (5 seconds per user)
  if (cooldownActive) {
    if (isDebug) console.log(`Mention rejected: user ${authorId} is currently on cooldown`);
    return { handled: false, reason: "cooldown" };
  }

  // Record cooldown timestamp
  recordUserCooldown(authorId);

  // 7. Select a random personality response
  const responseText = getRandomAdminResponse();

  // 8. Reply directly to the message without pinging the admin
  if (isDebug) console.log("Attempting reply: true");
  try {
    if (isDebug) console.log(`[Admin Chat Reply] Sending to channel ${channelId}, referencing message ${message.id}...`);
    const res = await sendDiscordChannelMessage({
      channelId,
      env,
      content: responseText,
      message_reference: {
        message_id: message.id,
        channel_id: channelId,
        fail_if_not_exists: false,
      },
      allowed_mentions: {
        replied_user: false,
        parse: [],
      },
      customFetch,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Discord API Reply Error (Status ${res.status}):`, errText);
      return { handled: false, reason: "api_error", status: res.status, error: errText };
    }

    if (isDebug) console.log("[Admin Chat Reply] Message posted successfully!");
    return { handled: true, response: responseText };
  } catch (err) {
    console.error("Discord API Network/Execution Error:", err?.message || err);
    return { handled: false, reason: "send_failed", error: err?.message || err };
  }
}
