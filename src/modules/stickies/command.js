/**
 * Slash Command Handler: /sticky
 * Subcommands: create, edit, set, remove, off, status
 */

import {
  ephemeralTextResponse,
  modalResponse,
} from "../../shared/discord.js";
import { requireStaffRole } from "../../shared/permissions.js";
import { buildStickyModal } from "./modals.js";

/**
 * Handle /sticky slash command.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} ctx
 * @returns {Promise<Response>}
 */
export async function handleStickyCommand(interaction, env, ctx) {
  // Restrict sticky commands to StaffTeam or Owner roles
  const authError = requireStaffRole(
    interaction,
    env,
    "❌ You do not have permission to manage sticky messages."
  );
  if (authError) {
    return authError;
  }

  const subCommand = interaction.data?.options?.[0];
  const subCommandName = subCommand?.name;
  const options = subCommand?.options || [];

  const channelOption = options.find((opt) => opt.name === "channel");
  const messageOption = options.find((opt) => opt.name === "message");
  const buttonOption = options.find((opt) => opt.name === "button");

  const targetChannelId =
    channelOption?.value || interaction.channel_id || interaction.channel?.id;
  const stickyMessageText = messageOption?.value;
  const buttonAction = buttonOption?.value || null;
  const guildId = interaction.guild_id || interaction.member?.guild_id || null;

  if (!env.STICKY_BOT) {
    return ephemeralTextResponse(
      "❌ StickyBot Durable Object binding is not configured."
    );
  }

  const doId = env.STICKY_BOT.idFromName("global");
  const stub = env.STICKY_BOT.get(doId);

  // 1. /sticky create (opens modal)
  if (subCommandName === "create") {
    if (!targetChannelId) {
      return ephemeralTextResponse(
        "❌ Could not determine channel for sticky message."
      );
    }

    const modal = buildStickyModal({
      channelId: targetChannelId,
      buttonAction: buttonAction || "none",
      existingText: "",
      isEdit: false,
    });

    return modalResponse(modal);
  }

  // 2. /sticky edit (opens modal pre-filled with existing text)
  if (subCommandName === "edit") {
    if (!targetChannelId) {
      return ephemeralTextResponse(
        "❌ Could not determine channel for sticky message."
      );
    }

    try {
      const doRes = await stub.fetch(
        `https://do/sticky/status?channelId=${targetChannelId}`
      );
      const statusData = await doRes.json();

      if (!statusData || !statusData.enabled || !statusData.message_text) {
        return ephemeralTextResponse(
          `❌ No active sticky message found for <#${targetChannelId}>. Use \`/sticky create\` to set one up.`
        );
      }

      const modal = buildStickyModal({
        channelId: targetChannelId,
        buttonAction: statusData.button_action || "none",
        existingText: statusData.message_text,
        isEdit: true,
      });

      return modalResponse(modal);
    } catch (err) {
      return ephemeralTextResponse(
        `❌ Error opening sticky editor: ${err.message}`
      );
    }
  }

  // 3. /sticky set (supports modal if message omitted, or direct set if message passed)
  if (subCommandName === "set") {
    if (!targetChannelId) {
      return new Response("Missing required options for /sticky set", {
        status: 400,
      });
    }

    if (!stickyMessageText) {
      const modal = buildStickyModal({
        channelId: targetChannelId,
        buttonAction: buttonAction || "none",
        existingText: "",
        isEdit: false,
      });

      return modalResponse(modal);
    }

    try {
      const doRes = await stub.fetch("https://do/sticky/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: targetChannelId,
          guildId,
          messageText: stickyMessageText,
          buttonAction,
        }),
      });

      if (!doRes.ok) {
        const err = await doRes.text();
        return ephemeralTextResponse(`❌ Failed to set sticky message: ${err}`);
      }

      return ephemeralTextResponse(
        `✅ Sticky message enabled for <#${targetChannelId}>.`
      );
    } catch (err) {
      return ephemeralTextResponse(
        `❌ Error enabling sticky message: ${err.message}`
      );
    }
  }

  // 4. /sticky remove or /sticky off
  if (subCommandName === "remove" || subCommandName === "off") {
    if (!targetChannelId) {
      return new Response("Missing required channel option for /sticky off", {
        status: 400,
      });
    }

    try {
      await stub.fetch("https://do/sticky/off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: targetChannelId,
        }),
      });

      return ephemeralTextResponse(
        `✅ Sticky message disabled for <#${targetChannelId}>.`
      );
    } catch (err) {
      return ephemeralTextResponse(
        `❌ Error disabling sticky message: ${err.message}`
      );
    }
  }

  // 5. /sticky status
  if (subCommandName === "status") {
    if (!targetChannelId) {
      return new Response("Missing required channel option for /sticky status", {
        status: 400,
      });
    }

    try {
      const doRes = await stub.fetch(
        `https://do/sticky/status?channelId=${targetChannelId}`
      );
      const statusData = await doRes.json();

      if (statusData && statusData.enabled) {
        const buttonDisplay =
          statusData.button_action === "punishment_center"
            ? "⚖️ Open Punishment Center"
            : statusData.button_action === "refund_center"
            ? "💰 Open Refund Center"
            : statusData.button_action === "both"
            ? "🛡️ Punishment Center + 💰 Refund Center"
            : statusData.button_label
            ? statusData.button_label
            : "None";

        return ephemeralTextResponse(
          `📌 **Sticky Message Status**\n\n**Channel:** <#${targetChannelId}>\n**Status:** Enabled 🟢\n**Button:** ${buttonDisplay}\n**Configured Message:**\n${statusData.message_text}`
        );
      }

      return ephemeralTextResponse(
        `📌 **Sticky Message Status**\n\n**Channel:** <#${targetChannelId}>\n**Status:** Disabled ⚪\nNo sticky message configured for this channel.`
      );
    } catch (err) {
      return ephemeralTextResponse(
        `❌ Error fetching sticky status: ${err.message}`
      );
    }
  }

  return new Response("Unknown sticky subcommand", { status: 400 });
}
