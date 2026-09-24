/**
 * Slash Command Handler: /referral
 */

import {
  ephemeralTextResponse,
  getUserFromInteraction,
  getCommandOption,
} from "../../shared/discord.js";
import { submitReferralToSheet } from "./sheets.js";
import { referralConfig, isReferralChannel } from "../../config.js";

/**
 * Handle /referral slash command.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} ctx
 * @returns {Promise<Response>}
 */
export async function handleReferralCommand(interaction, env, ctx) {
  if (referralConfig.enabled === false) {
    return ephemeralTextResponse("❌ The Referral system is currently disabled.");
  }

  const channelId = String(
    interaction.channel_id || interaction.channel?.id || ""
  ).trim();
  if (!isReferralChannel(channelId, env)) {
    return ephemeralTextResponse(
      "❌ The referral command cannot be used in this channel."
    );
  }

  const referrerId = getCommandOption(interaction, "referrer");
  const submittingUser = getUserFromInteraction(interaction);
  const submittingUserId = submittingUser?.id;

  if (!referrerId || !submittingUserId) {
    return new Response("Missing required referral data", {
      status: 400,
    });
  }

  // Self-referral protection
  if (submittingUserId === referrerId) {
    return ephemeralTextResponse("❌ You cannot list yourself as your referrer.");
  }

  // Extract display names
  const submittingDisplayName =
    interaction.member?.nick ||
    submittingUser?.global_name ||
    submittingUser?.username ||
    submittingUserId;

  const resolvedMember =
    interaction.data?.resolved?.members?.[referrerId];
  const resolvedUser =
    interaction.data?.resolved?.users?.[referrerId];
  const referrerDisplayName =
    resolvedMember?.nick ||
    resolvedUser?.global_name ||
    resolvedUser?.username ||
    referrerId;

  try {
    const result = await submitReferralToSheet({
      env,
      referredPlayerName: submittingDisplayName,
      referredPlayerId: submittingUserId,
      referredByName: referrerDisplayName,
      referredById: referrerId,
      joinedAt: interaction.member?.joined_at,
    });

    if (result.status === "DUPLICATE") {
      return ephemeralTextResponse(
        "❌ Referral Already Submitted\n\nYou already have a referral submission on file. If you believe this is incorrect, please contact staff."
      );
    }

    return ephemeralTextResponse(
      "✅ Referral Submitted\n\nYou and the person who referred you have been added to the referral list.\n\nOnce all referral requirements have been met, we'll reach out to you."
    );
  } catch (error) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.error("Referral submission error:", error?.message || "Internal error");
    }
    return ephemeralTextResponse(
      "❌ Submission Error\n\nAn error occurred while submitting your referral. Please try again later or contact staff."
    );
  }
}
