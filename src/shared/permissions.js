/**
 * Shared Permission & Role Verification Service.
 * Centralized authorization enforcement for staff-restricted commands and components.
 */

import {
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
} from "../config/roles.js";
import { isSuperadmin } from "../config/helpers.js";
import { ephemeralTextResponse, getMemberRoles } from "./discord.js";

/**
 * Check if the interaction member has the Staff Team role or Owner role.
 *
 * CRITICAL SECURITY RULE:
 * This is STAFF / OWNER ONLY.
 * Administrator role does NOT bypass the role requirement.
 *
 * @param {Object} interaction Discord interaction object
 * @param {Object} env Cloudflare Worker environment
 * @returns {boolean}
 */
export function hasStaffRole(interaction, env = {}) {
  const staffRoleId = String(
    env.STAFF_TEAM_ROLE_ID || DEFAULT_STAFF_TEAM_ROLE_ID
  ).trim();
  const ownerRoleId = String(
    env.OWNER_ROLE_ID || DEFAULT_OWNER_ROLE_ID
  ).trim();

  const memberRoles = getMemberRoles(interaction);

  return (
    (staffRoleId.length > 0 && memberRoles.includes(staffRoleId)) ||
    (ownerRoleId.length > 0 && memberRoles.includes(ownerRoleId))
  );
}

/**
 * Enforce staff role authorization with standard error response.
 *
 * @param {Object} interaction Discord interaction object
 * @param {Object} env Cloudflare Worker environment
 * @param {string} [customErrorMessage="❌ This feature is only available to Vital RP staff."]
 * @returns {{ isStaff: boolean, errorResponse: Response|null }}
 */
export function verifyStaffRole(
  interaction,
  env = {},
  customErrorMessage = "❌ This feature is only available to Vital RP staff."
) {
  const isAuthorized = hasStaffRole(interaction, env);

  if (!isAuthorized) {
    return {
      isStaff: false,
      errorResponse: ephemeralTextResponse(customErrorMessage),
    };
  }

  return { isStaff: true, errorResponse: null };
}

/**
 * Guard helper that returns an error response if unauthorized, or null if authorized.
 * Useful for one-liner guards in command handlers:
 *
 * const authError = requireStaffRole(interaction, env);
 * if (authError) return authError;
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {string} [customErrorMessage]
 * @returns {Response|null}
 */
export function requireStaffRole(interaction, env, customErrorMessage) {
  const result = verifyStaffRole(interaction, env, customErrorMessage);
  return result.isStaff ? null : result.errorResponse;
}

/**
 * Check if a member has any role from a list of allowed role IDs.
 *
 * @param {Object} interaction
 * @param {string[]} allowedRoleIds
 * @returns {boolean}
 */
export function hasAnyRole(interaction, allowedRoleIds = []) {
  const memberRoles = getMemberRoles(interaction);
  const normalizedAllowed = allowedRoleIds.map((r) => String(r).trim());
  return memberRoles.some((roleId) => normalizedAllowed.includes(roleId));
}

/**
 * Check if the interaction member or user is a configured Bot Superadmin.
 *
 * @param {Object} interaction Discord interaction object
 * @returns {boolean}
 */
export function hasSuperadminRole(interaction) {
  return isSuperadmin(interaction);
}

/**
 * Enforce superadmin authorization with standard error response.
 *
 * @param {Object} interaction Discord interaction object
 * @param {Object} env Cloudflare Worker environment
 * @param {string} [customErrorMessage="❌ Only bot superadmins can configure this feature."]
 * @returns {{ isSuperadmin: boolean, errorResponse: Response|null }}
 */
export function verifySuperadmin(
  interaction,
  env = {},
  customErrorMessage = "❌ Only bot superadmins can configure this feature."
) {
  const isAuthorized = isSuperadmin(interaction);

  if (!isAuthorized) {
    return {
      isSuperadmin: false,
      errorResponse: ephemeralTextResponse(customErrorMessage),
    };
  }

  return { isSuperadmin: true, errorResponse: null };
}

/**
 * Guard helper that returns an error response if not a superadmin, or null if authorized.
 * Useful for one-liner guards in command handlers:
 *
 * const authError = requireSuperadmin(interaction, env);
 * if (authError) return authError;
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {string} [customErrorMessage]
 * @returns {Response|null}
 */
export function requireSuperadmin(interaction, env, customErrorMessage) {
  const result = verifySuperadmin(interaction, env, customErrorMessage);
  return result.isSuperadmin ? null : result.errorResponse;
}
