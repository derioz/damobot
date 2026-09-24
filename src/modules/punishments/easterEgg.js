import {
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import { verifyStaffRole } from "./handlers.js";

/**
 * Centralized array of Damo-Bot easter egg diagnostic conclusions.
 * Short, harmless, funny, and Damo-Bot themed.
 */
export const DAMO_EASTER_EGG_RESPONSES = [
  "WOMP WOMP.",
  "Damon did this. I have no evidence, but I'm confident.",
  "This appears to be above my pay grade. My pay grade is $0.",
  "After extensive analysis: skill issue.",
  "I was told this button was important. I was lied to.",
  "Please hold while I pretend to contact management.",
  "Neural processors indicate a 97.4% chance Damon added this for no reason.",
  "Congratulations. You found the button nobody was supposed to press.",
  "I have notified absolutely no one.",
  "This interaction will be included in your permanent imaginary record.",
  "Analysis complete. Nothing useful was discovered.",
  "Thank you for pressing the unnecessary button.",
  "Great. Now Damon knows this works.",
  "My sensors detected an urgent situation. My programming decided to ignore it.",
  "Error 404: Importance not found.",
  "Running diagnostics... Status: Still unpaid. Still sarcastic.",
  "If you were hoping for a promotion, this button didn't help.",
  "System alert: Absolutely nothing requires your immediate attention.",
];

/**
 * Handle Message Context Command: "Definitely Important"
 * Right click Discord message -> Apps -> Definitely Important
 *
 * Ephemeral, staff-only easter egg.
 * Does not analyze or store message data.
 * Does not write to Google Sheets, Durable Objects, or external services.
 * Does not use AI.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} ctx
 * @returns {Promise<Response>}
 */
export async function handleMessageContextDefinitelyImportant(
  interaction,
  env,
  ctx
) {
  const auth = verifyStaffRole(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  const randomIndex = Math.floor(
    Math.random() * DAMO_EASTER_EGG_RESPONSES.length
  );
  const conclusion = DAMO_EASTER_EGG_RESPONSES[randomIndex];

  const content =
    `🤖 **Damo-Bot Diagnostic**\n\n` +
    `I have reviewed this message thoroughly.\n\n` +
    `**Conclusion:** ${conclusion}\n\n` +
    `-# Damo-Bot • unpaid digital employee`;

  return new Response(
    JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: InteractionResponseFlags.EPHEMERAL,
        content,
      },
    }),
    {
      headers: {
        "content-type": "application/json",
      },
    }
  );
}
