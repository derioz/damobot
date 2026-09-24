/**
 * Ticket Reminder Scheduled Cron Processing.
 * Executes every minute to deliver due ticket reminders to the Support Chat channel.
 */

import {
  DEFAULT_TICKET_REMINDER_CHANNEL_ID,
  DEFAULT_SUPPORT_ROLE_ID,
  DEFAULT_MODERATOR_ROLE_ID,
  ReminderType,
  isRemindersEnabled,
} from "./constants.js";
import {
  getDueReminders,
  claimReminder,
  markReminderSent,
  revertReminderPending,
} from "./db.js";

/**
 * Process all due ticket reminders in Cloudflare D1 and post alerts to Support Chat.
 *
 * @param {Object} env Cloudflare Worker environment
 * @param {Object} ctx Execution context
 * @returns {Promise<number>} Number of processed reminders
 */
export async function processDueTicketReminders(env, ctx) {
  // 0. Feature flag check
  if (!isRemindersEnabled(env)) {
    return 0;
  }

  let db;
  try {
    db = env?.PUNISHMENT_DB || env?.DB || env?.damo_bot_punishments;
  } catch {}

  if (!db) {
    return 0;
  }

  const nowIso = new Date().toISOString();
  let dueReminders;
  try {
    dueReminders = await getDueReminders({ env, nowIso, limit: 50 });
  } catch (err) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.error("[reminders-cron] Failed to fetch due reminders:", err?.message || err);
    }
    return 0;
  }

  if (!dueReminders || dueReminders.length === 0) {
    return 0;
  }

  const channelId =
    env.TICKET_REMINDER_CHANNEL_ID || DEFAULT_TICKET_REMINDER_CHANNEL_ID;
  const botToken = env.DISCORD_BOT_TOKEN;

  if (!botToken || !channelId) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.error(
        "[reminders-cron] Missing DISCORD_BOT_TOKEN or TICKET_REMINDER_CHANNEL_ID. Cannot post reminders."
      );
    }
    return 0;
  }

  const supportRoleId =
    env.SUPPORT_STAFF_ROLE_ID ||
    env.SUPPORT_ROLE_ID ||
    DEFAULT_SUPPORT_ROLE_ID;
  const moderatorRoleId =
    env.MODERATOR_ROLE_ID || DEFAULT_MODERATOR_ROLE_ID;

  let processedCount = 0;

  for (const reminder of dueReminders) {
    // 1. Atomically claim reminder to avoid duplicate processing across concurrent cron executions
    const claimed = await claimReminder({ env, id: reminder.id }).catch(() => false);
    if (!claimed) {
      continue;
    }

    try {
      const threadLink = `https://discord.com/channels/${reminder.guild_id}/${reminder.thread_id}`;
      const threadLabel = reminder.thread_name ? `#${reminder.thread_name}` : "Open Ticket";

      let content;
      let allowedMentions;

      if (reminder.reminder_type === ReminderType.STAFF) {
        // Generic Admin Reminder for the entire staff team
        content = [
          `⏰ **Ticket Reminder**`,
          ``,
          `<@&${supportRoleId}> <@&${moderatorRoleId}>`,
          ``,
          `This ticket needs to be checked.`,
          ``,
          `**Reminder:** ${reminder.reminder_message}`,
          ``,
          `🔗 **Ticket:** [${threadLabel}](${threadLink})`,
        ].join("\n");

        allowedMentions = {
          roles: [supportRoleId, moderatorRoleId],
        };
      } else {
        // Personal Reminder for the specific staff member
        content = [
          `⏰ **Ticket Reminder**`,
          ``,
          `<@${reminder.created_by_user_id}>, your ticket reminder is due.`,
          ``,
          `**Reminder:** ${reminder.reminder_message}`,
          ``,
          `🔗 **Ticket:** [${threadLabel}](${threadLink})`,
        ].join("\n");

        allowedMentions = {
          users: [reminder.created_by_user_id],
        };
      }

      // 2. Post reminder to Support Chat channel
      const postUrl = `https://discord.com/api/v10/channels/${channelId}/messages`;
      const postRes = await fetch(postUrl, {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          allowed_mentions: allowedMentions,
        }),
      });

      if (!postRes.ok) {
        const errorText = await postRes.text().catch(() => "");
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.error(
            `[reminders-cron] Failed to post reminder ${reminder.id} to Discord (${postRes.status}):`,
            errorText
          );
        }
        // Revert back to pending so it can retry on the next cron execution
        await revertReminderPending({ env, id: reminder.id }).catch(() => {});
        continue;
      }

      // 3. Mark as sent with sent_at timestamp
      const sentAtIso = new Date().toISOString();
      await markReminderSent({ env, id: reminder.id, sentAtIso });
      processedCount++;
    } catch (err) {
      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.error(
          `[reminders-cron] Error delivering reminder ${reminder.id}:`,
          err?.message || err
        );
      }
      await revertReminderPending({ env, id: reminder.id }).catch(() => {});
    }
  }

  return processedCount;
}
