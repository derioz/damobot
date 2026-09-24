/**
 * Ticket Reminder Discord Interaction Handlers.
 */

import {
  jsonResponse,
  ephemeralTextResponse,
  updateComponentsResponse,
} from "../../shared/discord.js";
import { requireStaffRole } from "../../shared/permissions.js";
import {
  DEFAULT_SUPPORT_ROLE_ID,
  DEFAULT_MODERATOR_ROLE_ID,
  ReminderType,
  ReminderCustomId,
  DEFAULT_PERSONAL_REMINDER_MESSAGE,
  DEFAULT_GENERIC_REMINDER_MESSAGE,
  isRemindersEnabled,
} from "./constants.js";
import {
  parseReminderDuration,
  formatDiscordRelativeTime,
  formatDiscordFullTime,
} from "./time.js";
import {
  isThreadChannel,
  canCreateGenericReminder,
  canCancelReminder,
  hasAdminPermission,
} from "./permissions.js";
import {
  createReminder,
  cancelReminder,
  getReminderById,
  getPendingRemindersByUser,
  getPendingRemindersByThread,
} from "./db.js";

/**
 * Handle the /remind slash command.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function handleRemindCommand(interaction, env) {
  // 0. Feature flag check
  if (!isRemindersEnabled(env)) {
    return ephemeralTextResponse("Ticket reminders are currently disabled.");
  }

  // 1. Enforce Staff Role authorization
  const authError = requireStaffRole(
    interaction,
    env,
    "❌ This feature is only available to Vital RP staff."
  );
  if (authError) {
    return authError;
  }

  // 2. Thread-only check
  if (!isThreadChannel(interaction)) {
    return ephemeralTextResponse(
      "Ticket reminders can only be created inside a ticket thread."
    );
  }

  const staffId =
    interaction.member?.user?.id ||
    interaction.user?.id ||
    "";
  const guildId =
    interaction.guild_id ||
    interaction.guild?.id ||
    env.DISCORD_GUILD_ID ||
    "";
  const threadId =
    interaction.channel?.id ||
    interaction.channel_id ||
    "";
  const threadName =
    interaction.channel?.name ||
    "";
  const parentChannelId =
    interaction.channel?.parent_id ||
    "";

  const options = interaction.data?.options || [];
  const firstOption = options[0];

  // Determine subcommand: 'create', 'set', 'list', 'cancel', or top-level options
  let subcommand = "";
  let subOptions = [];

  if (firstOption && firstOption.type === 1) {
    subcommand = firstOption.name.toLowerCase();
    subOptions = firstOption.options || [];
  } else {
    // Top-level invocation: /remind time:24h message:...
    subcommand = "create";
    subOptions = options;
  }

  // 3. /remind list
  if (subcommand === "list") {
    try {
      const reminders = await getPendingRemindersByUser({
        env,
        userId: staffId,
        limit: 10,
      });

      if (!reminders || reminders.length === 0) {
        return ephemeralTextResponse(
          "ℹ️ You have no active pending ticket reminders."
        );
      }

      const lines = [
        "⏰ **Your Active Ticket Reminders**",
        "",
      ];

      for (const r of reminders) {
        const d = new Date(r.remind_at);
        const rel = formatDiscordRelativeTime(d);
        const full = formatDiscordFullTime(d);
        const threadLink = `https://discord.com/channels/${r.guild_id}/${r.thread_id}`;
        const nameDisplay = r.thread_name ? `#${r.thread_name}` : "Ticket Thread";
        const typeBadge = r.reminder_type === ReminderType.STAFF ? " `[Staff Generic]`" : "";

        lines.push(
          `• ${rel} (${full}) — [${nameDisplay}](${threadLink})${typeBadge}\n  > ${r.reminder_message}\n  \`ID: ${r.id}\``
        );
      }

      return ephemeralTextResponse(lines.join("\n"));
    } catch (err) {
      return ephemeralTextResponse(`❌ Error fetching your reminders: ${err.message}`);
    }
  }

  // 4. /remind cancel [id]
  if (subcommand === "cancel") {
    const idArg = subOptions.find((o) => o.name === "id")?.value;
    let targetReminder = null;

    try {
      if (idArg) {
        targetReminder = await getReminderById({ env, id: String(idArg).trim() });
      } else {
        // If no ID is passed, check active reminders in this current thread
        const threadReminders = await getPendingRemindersByThread({
          env,
          threadId,
        });
        if (threadReminders && threadReminders.length > 0) {
          // Find reminder created by this user, or if admin, latest reminder
          targetReminder =
            threadReminders.find((r) => r.created_by_user_id === staffId) ||
            (hasAdminPermission(interaction, env) ? threadReminders[0] : null);
        }
      }

      if (!targetReminder) {
        return ephemeralTextResponse(
          "❌ No matching active pending reminder found to cancel."
        );
      }

      // Check cancellation permission
      if (!canCancelReminder(interaction, env, targetReminder)) {
        return ephemeralTextResponse(
          "❌ You do not have permission to cancel this reminder. Only the creator or an Administrator can cancel it."
        );
      }

      await cancelReminder({ env, id: targetReminder.id });

      return ephemeralTextResponse(
        `✅ **Ticket Reminder Cancelled**\n\nReminder \`${targetReminder.id}\` for this ticket has been cancelled.`
      );
    } catch (err) {
      return ephemeralTextResponse(`❌ Error cancelling reminder: ${err.message}`);
    }
  }

  // 5. /remind create or /remind set
  if (subcommand === "create" || subcommand === "set") {
    const timeVal = subOptions.find((o) => o.name === "time")?.value;
    const msgVal = subOptions.find((o) => o.name === "message")?.value;
    const genericVal = Boolean(subOptions.find((o) => o.name === "generic")?.value);

    if (!timeVal) {
      return ephemeralTextResponse("❌ You must specify a duration for the reminder (e.g. `time:24h`).");
    }

    const parsedDuration = parseReminderDuration(String(timeVal));
    if (!parsedDuration) {
      return ephemeralTextResponse(
        `❌ **Invalid time format:** "${timeVal}".\n\nPlease use a valid duration such as \`30m\`, \`1h\`, \`2h\`, \`6h\`, \`12h\`, \`24h\`, \`2d\`, \`3d\`, or \`7d\`.`
      );
    }

    // Generic Admin Reminder Permission Check
    if (genericVal) {
      if (!canCreateGenericReminder(interaction, env)) {
        return ephemeralTextResponse(
          "❌ **Permission Denied:** Only Administrators can create generic staff reminders (`generic:true`)."
        );
      }
    }

    const reminderType = genericVal ? ReminderType.STAFF : ReminderType.PERSONAL;
    const defaultMsg = genericVal
      ? DEFAULT_GENERIC_REMINDER_MESSAGE
      : DEFAULT_PERSONAL_REMINDER_MESSAGE;

    const finalMessage = msgVal && String(msgVal).trim() ? String(msgVal).trim() : defaultMsg;
    const remindAtDate = new Date(Date.now() + parsedDuration.durationMs);
    const remindAtIso = remindAtDate.toISOString();

    try {
      const saved = await createReminder({
        env,
        reminder: {
          guild_id: guildId,
          thread_id: threadId,
          thread_name: threadName,
          parent_channel_id: parentChannelId,
          created_by_user_id: staffId,
          reminder_type: reminderType,
          reminder_message: finalMessage,
          created_at: new Date().toISOString(),
          remind_at: remindAtIso,
        },
      });

      const relTimestamp = formatDiscordRelativeTime(remindAtDate);
      const fullTimestamp = formatDiscordFullTime(remindAtDate);

      const supportRoleId =
        env.SUPPORT_STAFF_ROLE_ID ||
        env.SUPPORT_ROLE_ID ||
        DEFAULT_SUPPORT_ROLE_ID;
      const moderatorRoleId =
        env.MODERATOR_ROLE_ID || DEFAULT_MODERATOR_ROLE_ID;

      let confirmationContent;
      if (genericVal) {
        confirmationContent = [
          `⏰ **Ticket Reminder Set**`,
          ``,
          `I'll remind Support Staff (<@&${supportRoleId}>) and Moderators (<@&${moderatorRoleId}>) to check this ticket ${relTimestamp} (${fullTimestamp}).`,
          ``,
          `**Reminder:** ${finalMessage}`,
        ].join("\n");
      } else {
        confirmationContent = [
          `⏰ **Ticket Reminder Set**`,
          ``,
          `I'll remind <@${staffId}> to check this ticket ${relTimestamp} (${fullTimestamp}).`,
          ``,
          `**Reminder:** ${finalMessage}`,
        ].join("\n");
      }

      // Public confirmation message in thread with Cancel button
      return jsonResponse({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE (public in thread)
        data: {
          content: confirmationContent,
          components: [
            {
              type: 1, // Action Row
              components: [
                {
                  type: 2, // Button
                  custom_id: `${ReminderCustomId.BTN_CANCEL_PREFIX}${saved.id}`,
                  label: "Cancel Reminder",
                  style: 2, // Secondary
                  emoji: { name: "⏹️" },
                },
              ],
            },
          ],
        },
      });
    } catch (err) {
      return ephemeralTextResponse(`❌ Failed to set ticket reminder: ${err.message}`);
    }
  }

  return ephemeralTextResponse("❌ Unknown reminder action. Use `/remind create time:...`");
}

/**
 * Handle interactive button clicks for ticket reminders (e.g. Cancel Reminder).
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function handleRemindComponent(interaction, env) {
  // 0. Feature flag check
  if (!isRemindersEnabled(env)) {
    return ephemeralTextResponse("Ticket reminders are currently disabled.");
  }

  const customId = interaction.data?.custom_id || "";

  if (customId.startsWith(ReminderCustomId.BTN_CANCEL_PREFIX)) {
    const reminderId = customId.slice(ReminderCustomId.BTN_CANCEL_PREFIX.length);

    try {
      const reminder = await getReminderById({ env, id: reminderId });
      if (!reminder) {
        return ephemeralTextResponse("❌ This reminder no longer exists or has already expired.");
      }

      if (reminder.status !== "pending") {
        return ephemeralTextResponse(
          `ℹ️ This reminder is already marked as \`${reminder.status}\`.`
        );
      }

      if (!canCancelReminder(interaction, env, reminder)) {
        return ephemeralTextResponse(
          "❌ You do not have permission to cancel this reminder. Only the creator or an Administrator can cancel it."
        );
      }

      await cancelReminder({ env, id: reminderId });

      return jsonResponse({
        type: 7, // UPDATE_MESSAGE
        data: {
          content: `⏰ **Ticket Reminder Cancelled**\n\nThe reminder for this ticket has been cancelled.`,
          components: [],
        },
      });
    } catch (err) {
      return ephemeralTextResponse(`❌ Failed to cancel reminder: ${err.message}`);
    }
  }

  return ephemeralTextResponse("❌ Unknown reminder action.");
}
