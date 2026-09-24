/**
 * Ticket Reminder Permission & Channel Validation.
 */

import {
  DEFAULT_ADMINISTRATOR_ROLE_ID,
  DEFAULT_SENIOR_ADMINISTRATOR_ROLE_ID,
  DEFAULT_HEAD_ADMINISTRATOR_ROLE_ID,
  DEFAULT_VRP_MANAGEMENT_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  DEFAULT_HEAD_OF_STAFF_ROLE_ID,
} from "../../config/roles.js";
import { isSuperadmin } from "../../config/helpers.js";
import { hasStaffRole, hasAnyRole } from "../../shared/permissions.js";

/**
 * Check if the interaction was invoked inside a Discord thread.
 * Discord thread types:
 * - 10 = GUILD_NEWS_THREAD (Announcement Thread)
 * - 11 = GUILD_PUBLIC_THREAD (Public Thread)
 * - 12 = GUILD_PRIVATE_THREAD (Private Thread)
 *
 * @param {Object} interaction
 * @returns {boolean}
 */
export function isThreadChannel(interaction) {
  const channelType = interaction?.channel?.type;
  if (channelType === 10 || channelType === 11 || channelType === 12) {
    return true;
  }
  if (interaction?.channel?.thread_metadata) {
    return true;
  }
  return false;
}

/**
 * Check if the invoking member has Administrator / Management / Owner permissions.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {boolean}
 */
export function hasAdminPermission(interaction, env = {}) {
  if (isSuperadmin(interaction)) return true;

  // Check Discord native Administrator permission bit (0x8)
  if (interaction?.member?.permissions) {
    try {
      const perms = BigInt(interaction.member.permissions);
      if ((perms & 8n) === 8n) return true;
    } catch {}
  }

  const adminRoles = [
    env.ADMINISTRATOR_ROLE_ID || DEFAULT_ADMINISTRATOR_ROLE_ID,
    env.SENIOR_ADMINISTRATOR_ROLE_ID || DEFAULT_SENIOR_ADMINISTRATOR_ROLE_ID,
    env.HEAD_ADMINISTRATOR_ROLE_ID || DEFAULT_HEAD_ADMINISTRATOR_ROLE_ID,
    env.VRP_MANAGEMENT_ROLE_ID || DEFAULT_VRP_MANAGEMENT_ROLE_ID,
    env.OWNER_ROLE_ID || DEFAULT_OWNER_ROLE_ID,
    env.HEAD_OF_STAFF_ROLE_ID || DEFAULT_HEAD_OF_STAFF_ROLE_ID,
  ].filter(Boolean);

  return hasAnyRole(interaction, adminRoles);
}

/**
 * Verify if the member can create a generic staff reminder (Admin only).
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {boolean}
 */
export function canCreateGenericReminder(interaction, env = {}) {
  return hasAdminPermission(interaction, env);
}

/**
 * Verify if the member can cancel the given reminder.
 * Creator of personal reminder can cancel it.
 * Admins can cancel any reminder (including generic reminders).
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} reminder
 * @returns {boolean}
 */
export function canCancelReminder(interaction, env = {}, reminder) {
  if (!reminder) return false;

  const userId =
    interaction?.member?.user?.id ||
    interaction?.user?.id ||
    "";

  // Creator can cancel their own reminder
  if (userId && reminder.created_by_user_id === userId) {
    return true;
  }

  // Admins can cancel any reminder (including generic reminders)
  return hasAdminPermission(interaction, env);
}
