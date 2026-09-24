import {
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import { getModalValues } from "../../shared/discord.js";
import { requireStaffRole } from "../../shared/permissions.js";

/**
 * Handle sticky modal submissions (create & edit).
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} ctx
 * @returns {Promise<Response>}
 */
export async function handleStickyModalSubmit(interaction, env, ctx) {
  // 1. Permissions verification - StaffTeam or Owner roles
  const authError = requireStaffRole(
    interaction,
    env,
    "❌ You do not have permission to manage sticky messages."
  );
  if (authError) {
    return authError;
  }

  // 2. Parse customId: sticky_modal_create:channelId:buttonAction or sticky_modal_edit:channelId:buttonAction
  const customId = interaction.data?.custom_id || "";
  const isEdit = customId.startsWith("sticky_modal_edit:");
  const prefix = isEdit ? "sticky_modal_edit:" : "sticky_modal_create:";
  const payloadStr = customId.slice(prefix.length);
  const [channelId, buttonActionRaw] = payloadStr.split(":");
  const buttonAction = buttonActionRaw && buttonActionRaw !== "none" ? buttonActionRaw : null;
  const guildId = interaction.guild_id || interaction.member?.guild_id || null;

  if (!channelId) {
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "❌ Invalid sticky modal submission: missing channel ID.",
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  // 3. Extract text content without trimming internal blank lines / line breaks
  const values = getModalValues(interaction.data?.components || []);
  const messageText = values.sticky_content !== undefined ? values.sticky_content : "";

  if (!messageText || messageText.trim().length === 0) {
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "❌ Sticky message content cannot be empty.",
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  if (!env.STICKY_BOT) {
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "❌ StickyBot Durable Object binding is not configured.",
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  try {
    const doId = env.STICKY_BOT.idFromName("global");
    const stub = env.STICKY_BOT.get(doId);

    const doRes = await stub.fetch("https://do/sticky/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId,
        guildId,
        messageText,
        buttonAction,
      }),
    });

    if (!doRes.ok) {
      const err = await doRes.text();
      return new Response(
        JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `❌ Failed to save sticky message: ${err}`,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        }),
        { headers: { "content-type": "application/json" } }
      );
    }

    const actionDesc = isEdit ? "updated" : "created and enabled";
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `✅ Sticky message ${actionDesc} for <#${channelId}>.`,
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `❌ Error saving sticky message: ${err.message}`,
          flags: InteractionResponseFlags.EPHEMERAL,
        },
      }),
      { headers: { "content-type": "application/json" } }
    );
  }
}
