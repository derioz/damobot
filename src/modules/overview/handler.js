/**
 * Handler for /damobot application command.
 * Enforces staff authorization and returns the Components V2 overview container ephemerally.
 */

import { verifyStaffRole } from "../../shared/permissions.js";
import { ephemeralComponentsResponse } from "../../shared/discord.js";
import { buildDamoBotOverviewContainer } from "./features.js";

/**
 * Handle /damobot slash command.
 *
 * @param {Object} interaction Discord Interaction
 * @param {Object} env Cloudflare Worker environment
 * @param {Object} ctx Execution context
 * @returns {Promise<Response>}
 */
export async function handleDamoBotCommand(interaction, env, ctx) {
  // Enforce strict staff authorization (same role check as /logpunishment)
  const staffCheck = verifyStaffRole(interaction, env);
  if (!staffCheck.isStaff) {
    return staffCheck.errorResponse;
  }

  const container = buildDamoBotOverviewContainer();
  return ephemeralComponentsResponse(container);
}
