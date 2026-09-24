/**
 * Centralized Role & Channel Configuration Helpers.
 * Provides reusable permission checks and channel validation across all features.
 */

import { refundConfig } from "./refund.config.js";
import { loaConfig } from "./loa.config.js";
import { referralConfig } from "./referral.config.js";
import { suggestionsConfig } from "./suggestions.config.js";

/**
 * Extract Discord user ID from an interaction, member object, user object, or raw string ID.
 *
 * @param {Object|string} target
 * @returns {string}
 */
export function extractUserId(target) {
  if (!target) return "";
  if (typeof target === "string") {
    return target.trim();
  }
  return String(
    target.user?.id ||
      target.member?.user?.id ||
      target.member?.id ||
      target.id ||
      ""
  ).trim();
}

/**
 * Extract array of role IDs from an interaction, member object, or raw array.
 *
 * @param {Object|Array<string>} target
 * @returns {string[]}
 */
export function extractMemberRoles(target) {
  if (!target) return [];
  if (Array.isArray(target)) {
    return target.map((r) => String(r).trim()).filter(Boolean);
  }
  if (Array.isArray(target.roles)) {
    return target.roles.map((r) => String(r).trim()).filter(Boolean);
  }
  if (target.member && Array.isArray(target.member.roles)) {
    return target.member.roles.map((r) => String(r).trim()).filter(Boolean);
  }
  return [];
}

let _cachedSuperadminSet = null;

function getSuperadminSet() {
  if (!_cachedSuperadminSet) {
    _cachedSuperadminSet = new Set([
      ...(refundConfig.users?.superadmins || []),
      ...(loaConfig.users?.superadmins || []),
      ...(referralConfig.users?.superadmins || []),
      ...(suggestionsConfig.users?.superadmins || []),
    ]);
  }
  return _cachedSuperadminSet;
}

/**
 * Check if the target user is configured as a Bot Superadmin.
 * Superadmins bypass role restrictions for administrative features.
 *
 * @param {Object|string} target Member, interaction, user, or Discord user ID
 * @returns {boolean}
 */
export function isSuperadmin(target) {
  const userId = extractUserId(target);
  if (!userId) return false;

  return getSuperadminSet().has(userId);
}

/**
 * Check if a member or interaction has any role from a list of allowed role IDs.
 * Always returns true for configured bot superadmins.
 *
 * @param {Object|Array<string>} target Interaction, member, or role array
 * @param {string[]} allowedRoleIds List of allowed Discord role IDs
 * @returns {boolean}
 */
export function hasAnyRole(target, allowedRoleIds = []) {
  if (isSuperadmin(target)) {
    return true;
  }

  const memberRoles = extractMemberRoles(target);
  if (memberRoles.length === 0 || !allowedRoleIds || allowedRoleIds.length === 0) {
    return false;
  }

  const normalizedAllowed = new Set(allowedRoleIds.map((r) => String(r).trim()));

  return memberRoles.some((roleId) => normalizedAllowed.has(roleId));
}

/**
 * Check if a user/member has permission to access or manage the Refund Center.
 *
 * @param {Object} target Interaction or member
 * @param {Object} [env={}] Cloudflare Worker environment (for optional role overrides)
 * @returns {boolean}
 */
export function canManageRefunds(target, env = {}) {
  if (isSuperadmin(target)) return true;

  const allowedRoles = [
    ...(refundConfig.roles?.allowed || []),
    ...(refundConfig.roles?.managers || []),
  ];

  if (env.STAFF_TEAM_ROLE_ID) allowedRoles.push(env.STAFF_TEAM_ROLE_ID);
  if (env.OWNER_ROLE_ID) allowedRoles.push(env.OWNER_ROLE_ID);

  return hasAnyRole(target, allowedRoles);
}

/**
 * Check if a user/member has permission to access or manage the LOA Center.
 *
 * @param {Object} target Interaction or member
 * @param {Object} [env={}] Cloudflare Worker environment (for optional role overrides)
 * @returns {boolean}
 */
export function canManageLOAs(target, env = {}) {
  if (isSuperadmin(target)) return true;

  const allowedRoles = [
    ...(loaConfig.roles?.allowed || []),
    ...(loaConfig.roles?.managers || []),
    ...(loaConfig.protectedRoleIds || []),
  ];

  if (env.STAFF_TEAM_ROLE_ID) allowedRoles.push(env.STAFF_TEAM_ROLE_ID);
  if (env.OWNER_ROLE_ID) allowedRoles.push(env.OWNER_ROLE_ID);

  return hasAnyRole(target, allowedRoles);
}

/**
 * Check if a user/member currently has the Staff LOA role.
 *
 * @param {Object} target Interaction, member, or role array
 * @param {Object} [env={}]
 * @returns {boolean}
 */
export function hasStaffLoaRole(target, env = {}) {
  const loaRoleIds = new Set();

  if (env.STAFF_LOA_ROLE_ID) loaRoleIds.add(String(env.STAFF_LOA_ROLE_ID).trim());
  if (env.LOA_MODERATOR_ROLE_ID) loaRoleIds.add(String(env.LOA_MODERATOR_ROLE_ID).trim());
  if (env.LOA_SUPPORT_ROLE_ID) loaRoleIds.add(String(env.LOA_SUPPORT_ROLE_ID).trim());

  if (loaConfig.loaRoles?.moderator) loaRoleIds.add(String(loaConfig.loaRoles.moderator).trim());
  if (loaConfig.loaRoles?.support) loaRoleIds.add(String(loaConfig.loaRoles.support).trim());
  if (loaConfig.staffLoaRoleId) loaRoleIds.add(String(loaConfig.staffLoaRoleId).trim());

  loaRoleIds.delete("");
  if (loaRoleIds.size === 0) return false;
  return hasAnyRole(target, Array.from(loaRoleIds));
}

/**
 * Check if a user/member has permission to view LOA role snapshots and member LOA history.
 *
 * @param {Object} target Interaction or member
 * @param {Object} [env={}]
 * @returns {boolean}
 */
export function canViewLoaHistory(target, env = {}) {
  if (isSuperadmin(target)) return true;

  const allowedRoles = [
    ...(loaConfig.roles?.adminViewers || []),
    ...(loaConfig.roles?.managers || []),
  ];

  if (env.VRP_MANAGEMENT_ROLE_ID) allowedRoles.push(env.VRP_MANAGEMENT_ROLE_ID);
  if (env.OWNER_ROLE_ID) allowedRoles.push(env.OWNER_ROLE_ID);

  return hasAnyRole(target, allowedRoles);
}

/**
 * Get effective LOA configuration merged with optional environment overrides.
 *
 * @param {Object} [env={}]
 * @returns {Object}
 */
export function getLoaConfig(env = {}) {
  return {
    ...loaConfig,
    loaRoles: {
      moderator: env.LOA_MODERATOR_ROLE_ID || loaConfig.loaRoles?.moderator,
      support: env.LOA_SUPPORT_ROLE_ID || loaConfig.loaRoles?.support,
    },
    channels: {
      loaCenter: env.LOA_CHANNEL_ID || loaConfig.channels?.loaCenter,
      loaLog: env.LOA_LOG_CHANNEL_ID || loaConfig.channels?.loaLog,
      supportChat: env.SUPPORT_CHAT_CHANNEL_ID || loaConfig.channels?.supportChat,
      moderatorChat: env.MODERATOR_CHAT_CHANNEL_ID || loaConfig.channels?.moderatorChat,
    },
  };
}

/**
 * Check if a user/member has permission to access or manage the Referral system.
 *
 * @param {Object} target Interaction or member
 * @param {Object} [env={}] Cloudflare Worker environment (for optional role overrides)
 * @returns {boolean}
 */
export function canManageReferrals(target, env = {}) {
  if (isSuperadmin(target)) return true;

  const allowedRoles = [
    ...(referralConfig.roles?.allowed || []),
    ...(referralConfig.roles?.managers || []),
  ];

  if (env.STAFF_TEAM_ROLE_ID) allowedRoles.push(env.STAFF_TEAM_ROLE_ID);
  if (env.OWNER_ROLE_ID) allowedRoles.push(env.OWNER_ROLE_ID);

  return hasAnyRole(target, allowedRoles);
}

/**
 * Check if a channel ID matches the configured Refund Center channel.
 *
 * @param {string} channelId
 * @param {Object} [env={}]
 * @returns {boolean}
 */
export function isRefundCenterChannel(channelId, env = {}) {
  const configured =
    env.REFUND_CENTER_CHANNEL_ID || refundConfig.channels?.center;
  if (!configured) return true; // If unconfigured, not restricted
  return String(channelId || "").trim() === String(configured).trim();
}

/**
 * Check if a channel ID matches the configured LOA Center channel (1546281163247722516).
 *
 * @param {string} channelId
 * @param {Object} [env={}]
 * @returns {boolean}
 */
export function isLOACenterChannel(channelId, env = {}) {
  const configured =
    env.LOA_CHANNEL_ID || loaConfig.channels?.center || "1546281163247722516";
  return String(channelId || "").trim() === String(configured).trim();
}

/**
 * Check if a channel ID matches the configured LOA Log channel (1546698584613715998).
 *
 * @param {string} channelId
 * @param {Object} [env={}]
 * @returns {boolean}
 */
export function isLOALogChannel(channelId, env = {}) {
  const configured =
    env.LOA_LOG_CHANNEL_ID || loaConfig.channels?.logs || "1546698584613715998";
  return String(channelId || "").trim() === String(configured).trim();
}

/**
 * Check if a channel ID matches the configured Referral channel.
 * If empty/unconfigured, returns true (command allowed everywhere).
 *
 * @param {string} channelId
 * @param {Object} [env={}]
 * @returns {boolean}
 */
export function isReferralChannel(channelId, env = {}) {
  const configured =
    env.REFERRAL_CHANNEL_ID || referralConfig.channels?.referrals;
  if (!configured || !String(configured).trim()) {
    return true; // Allowed in all channels if not restricted
  }
  return String(channelId || "").trim() === String(configured).trim();
}
