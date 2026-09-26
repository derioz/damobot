/**
 * LOA Audit Logger.
 * Dispatches structured embeds to the dedicated private LOA log channel.
 */

import {
  DEFAULT_LOA_LOG_CHANNEL_ID,
  VITAL_ORANGE,
  VITAL_RP_LOGO_URL,
  DAMO_BOT_VERSION,
  loaConfig,
} from "../../config.js";
import { formatPrettyDateRange, formatPrettyDate } from "./dateUtils.js";
import { getGuildRoles } from "./roleUtils.js";

/**
 * Send an embed message to the configured LOA Log channel.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {Object} options.embed
 * @param {string} [options.content]
 * @param {Function} [options.customFetch=fetch]
 * @returns {Promise<{ success: boolean, status: number, error?: string }>}
 */
export async function sendLoaLogMessage({
  env,
  embed,
  content = "",
  customFetch = fetch,
}) {
  const channelId =
    env?.LOA_LOG_CHANNEL_ID ||
    loaConfig.channels?.logs ||
    DEFAULT_LOA_LOG_CHANNEL_ID;

  if (!env?.DISCORD_BOT_TOKEN || !channelId) {
    return { success: false, status: 0, error: "Missing bot token or log channel ID" };
  }

  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  try {
    const res = await customFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: content || undefined,
        embeds: [embed],
      }),
    });

    if (res.ok) {
      return { success: true, status: res.status };
    }

    const errText = await res.text();
    console.warn(`Failed to post to LOA log channel (${res.status}):`, errText);
    return { success: false, status: res.status, error: errText };
  } catch (err) {
    console.warn("Exception posting to LOA log channel:", err?.message || err);
    return { success: false, status: 0, error: err?.message || "Internal error" };
  }
}

/**
 * Log when a staff member begins an LOA and roles are snapshotted/swapped.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {string} options.displayName
 * @param {string} options.startDate
 * @param {string} options.endDate
 * @param {string} options.reason
 * @param {Array<string>} options.removedRoleIds
 * @param {Array<string>} options.preservedRoleIds
 * @param {string} options.staffLoaRoleId
 * @param {Function} [options.customFetch=fetch]
 */
export async function logLoaStarted({
  env,
  guildId,
  userId,
  displayName,
  startDate,
  endDate,
  reason,
  loa,
  removedRoleIds = [],
  preservedRoleIds = [],
  staffLoaRoleId,
  isProtectedStaff = false,
  customFetch = fetch,
}) {
  if (loa) {
    userId = userId || loa.user_id || loa.userId;
    displayName = displayName || loa.display_name || loa.displayName || `<@${userId}>`;
    startDate = startDate || loa.start_date || loa.startDate;
    endDate = endDate || loa.end_date || loa.endDate;
    reason = reason || loa.reason;
  }

  // Look up role names from guild roles
  const rolesRes = await getGuildRoles({ env, guildId, customFetch });
  const roleMap = rolesRes.success && rolesRes.roleMap ? rolesRes.roleMap : new Map();

  const removedRoleLines =
    removedRoleIds.length > 0
      ? removedRoleIds
          .map((id) => {
            const role = roleMap.get(id);
            return role ? `• ${role.name}` : `• Role ID: ${id}`;
          })
          .join("\n")
      : "• None";

  const preservedRoleLines =
    preservedRoleIds.length > 0
      ? preservedRoleIds
          .map((id) => {
            const role = roleMap.get(id);
            return role ? `• ${role.name}` : `• Role ID: ${id}`;
          })
          .join("\n")
      : "• Whitelist Approved\n• Keyboard Warrior\n• Gif\n• Member";

  const staffLoaRole = staffLoaRoleId ? roleMap.get(staffLoaRoleId) : null;
  const staffLoaRoleName = staffLoaRole ? staffLoaRole.name : "LOA";

  const isProtected = Boolean(
    isProtectedStaff ||
    (loa && (loa.is_protected_staff || loa.isProtectedStaff))
  );

  let fields;
  if (isProtected) {
    fields = [
      {
        name: "👤 Staff Member",
        value: `<@${userId}> (${displayName})`,
        inline: true,
      },
      {
        name: "📅 Schedule",
        value: formatPrettyDateRange(startDate, endDate),
        inline: true,
      },
      {
        name: "📝 Reason",
        value: reason ? `> ${reason}` : "> No reason provided",
        inline: false,
      },
      {
        name: "🛡️ Leadership Status",
        value: "✅ All server roles preserved (Administrator+). Zero roles removed.",
        inline: true,
      },
      {
        name: "🏷️ Applied Role",
        value: "• None (Leadership status maintained)",
        inline: true,
      },
      {
        name: "💾 Role Snapshot",
        value: "🛡️ Protected Leadership (Roles untouched)",
        inline: false,
      },
    ];
  } else {
    fields = [
      {
        name: "👤 Staff Member",
        value: `<@${userId}> (${displayName})`,
        inline: true,
      },
      {
        name: "📅 Schedule",
        value: formatPrettyDateRange(startDate, endDate),
        inline: true,
      },
      {
        name: "📝 Reason",
        value: reason ? `> ${reason}` : "> No reason provided",
        inline: false,
      },
      {
        name: `🔄 Roles Temporarily Removed (${removedRoleIds.length})`,
        value:
          removedRoleLines.length > 1024
            ? removedRoleLines.slice(0, 1000) + "\n• ...and more"
            : removedRoleLines,
        inline: false,
      },
      {
        name: `🛡️ Preserved Standard Roles (${preservedRoleIds.length})`,
        value: preservedRoleLines,
        inline: true,
      },
      {
        name: "🏷️ Applied Role",
        value: `• ${staffLoaRoleName}`,
        inline: true,
      },
      {
        name: "💾 Role Snapshot",
        value: "✅ Saved Successfully to Database",
        inline: false,
      },
    ];
  }

  const embed = {
    title: "🏖️ Staff LOA Started",
    description: `Staff member <@${userId}> has started a Leave of Absence.\n**Reason**: ${reason || "*No reason provided*"}`,
    color: VITAL_ORANGE,
    fields,
    thumbnail: { url: VITAL_RP_LOGO_URL },
    footer: {
      text: `Damo Bot • Staff LOA Manager • ${DAMO_BOT_VERSION}`,
    },
    timestamp: new Date().toISOString(),
  };

  await sendLoaLogMessage({ env, embed, customFetch });
}

/**
 * Log when a staff member returns from LOA (normal end or early return).
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {string} options.displayName
 * @param {string} [options.reasonText="returned from LOA"]
 * @param {Array<string>} options.restoredRoleIds
 * @param {Array<string>} options.failedRestoreRoleIds
 * @param {boolean} [options.isLegacy=false]
 * @param {boolean} [options.isProtectedStaff=false]
 * @param {Function} [options.customFetch=fetch]
 */
export async function logLoaEnded({
  env,
  guildId,
  userId,
  displayName,
  reasonText = "returned from LOA",
  restoredRoleIds = [],
  failedRestoreRoleIds = [],
  isLegacy = false,
  isProtectedStaff = false,
  customFetch = fetch,
}) {
  const rolesRes = await getGuildRoles({ env, guildId, customFetch });
  const roleMap = rolesRes.success && rolesRes.roleMap ? rolesRes.roleMap : new Map();

  let fields;
  if (isProtectedStaff) {
    fields = [
      {
        name: "👤 Staff Member",
        value: `<@${userId}> (${displayName})`,
        inline: true,
      },
      {
        name: "📋 Status",
        value: `Returned (${reasonText})`,
        inline: true,
      },
      {
        name: "🛡️ Leadership Roles",
        value: "✅ Preserved throughout LOA. Nickname restored.",
        inline: false,
      },
      {
        name: "⚙️ Role Status",
        value: "✅ Intact (No roles modified)",
        inline: true,
      },
    ];
  } else {
    const restoredLines =
      restoredRoleIds.length > 0
        ? restoredRoleIds
            .map((id) => {
              const role = roleMap.get(id);
              return role ? `• ${role.name}` : `• Role ID: ${id}`;
            })
            .join("\n")
        : isLegacy
          ? "⚠️ Legacy LOA — No previous snapshot was available. Roles must be checked manually by management."
          : "• None";

    fields = [
      {
        name: "👤 Staff Member",
        value: `<@${userId}> (${displayName})`,
        inline: true,
      },
      {
        name: "📋 Status",
        value: `Returned (${reasonText})`,
        inline: true,
      },
      {
        name: `✅ Roles Restored (${restoredRoleIds.length})`,
        value:
          restoredLines.length > 1024
            ? restoredLines.slice(0, 1000) + "\n• ...and more"
            : restoredLines,
        inline: false,
      },
      {
        name: "🏷️ Staff LOA Role",
        value: "Removed",
        inline: true,
      },
      {
        name: "⚙️ Restoration Status",
        value:
          failedRestoreRoleIds.length === 0
            ? "✅ Fully Restored"
            : `⚠️ Partial (${failedRestoreRoleIds.length} failed)`,
        inline: true,
      },
    ];

    if (failedRestoreRoleIds.length > 0) {
      const failedLines = failedRestoreRoleIds
        .map((id) => {
          const role = roleMap.get(id);
          return role ? `• ${role.name} (Role hierarchy conflict)` : `• Deleted Role (ID: ${id})`;
        })
        .join("\n");

      fields.push({
        name: `⚠️ Failed to Restore (${failedRestoreRoleIds.length})`,
        value: failedLines,
        inline: false,
      });
    }
  }

  const embed = {
    title: "✅ Staff Returned from LOA",
    description: `Staff member <@${userId}> (${displayName || "Staff"}) ${reasonText}.`,
    color: 5763719, // Discord Green (#57F287)
    fields,
    thumbnail: { url: VITAL_RP_LOGO_URL },
    footer: {
      text: `Damo Bot • Staff LOA Manager • ${DAMO_BOT_VERSION}`,
    },
    timestamp: new Date().toISOString(),
  };

  await sendLoaLogMessage({ env, embed, customFetch });
}

/**
 * Log an error or security/hierarchy warning to the LOA log channel.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} [options.guildId]
 * @param {string} [options.userId]
 * @param {string} [options.message]
 * @param {string} [options.title="Staff LOA Warning / Action Required"]
 * @param {string} [options.description]
 * @param {Array<Object>} [options.fields]
 * @param {Function} [options.customFetch=fetch]
 */
export async function logLoaWarning({
  env,
  guildId,
  userId,
  message,
  title = "Staff LOA Warning / Action Required",
  description,
  fields = [],
  customFetch = fetch,
}) {
  const descText = description || message || "An unexpected issue occurred during LOA processing.";
  const embed = {
    title: title.startsWith("⚠️") ? title : `⚠️ ${title}`,
    description: userId ? `Issue affecting <@${userId}>:\n\n${descText}` : descText,
    color: 15548997, // Discord Red (#ED4245)
    fields,
    thumbnail: { url: VITAL_RP_LOGO_URL },
    footer: {
      text: `Damo Bot • Staff LOA Alert • ${DAMO_BOT_VERSION}`,
    },
    timestamp: new Date().toISOString(),
  };

  await sendLoaLogMessage({ env, embed, customFetch });
}

/**
 * Log when an active or upcoming LOA is extended.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {string} options.displayName
 * @param {string} options.oldEndDate
 * @param {string} options.newEndDate
 * @param {string} [options.reason]
 * @param {string} [options.modifiedBy]
 * @param {Function} [options.customFetch=fetch]
 */
export async function logLoaExtended({
  env,
  guildId,
  userId,
  displayName,
  oldEndDate,
  newEndDate,
  reason = "",
  modifiedBy = null,
  customFetch = fetch,
}) {
  const isSelf = !modifiedBy || modifiedBy === userId;
  const modifierText = isSelf ? "Self-extended" : `Extended by <@${modifiedBy}>`;

  const fields = [
    {
      name: "👤 Staff Member",
      value: `<@${userId}> (${displayName || "Staff"})`,
      inline: true,
    },
    {
      name: "📅 Previous Return",
      value: formatPrettyDate(oldEndDate),
      inline: true,
    },
    {
      name: "📅 New Expected Return",
      value: formatPrettyDate(newEndDate),
      inline: true,
    },
    {
      name: "🛡️ Modified By",
      value: modifierText,
      inline: true,
    },
  ];

  if (reason) {
    fields.push({
      name: "📝 Reason / Note",
      value: `> ${reason}`,
      inline: false,
    });
  }

  const embed = {
    title: "📅 Staff LOA Extended",
    description: `Leave of Absence for <@${userId}> was extended to **${formatPrettyDate(newEndDate)}**.`,
    color: VITAL_ORANGE,
    fields,
    thumbnail: { url: VITAL_RP_LOGO_URL },
    footer: {
      text: `Damo Bot • Staff LOA Manager • ${DAMO_BOT_VERSION}`,
    },
    timestamp: new Date().toISOString(),
  };

  await sendLoaLogMessage({ env, embed, customFetch });
}

/**
 * Log when an LOA reason is updated.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {string} options.displayName
 * @param {string} options.oldReason
 * @param {string} options.newReason
 * @param {string} [options.modifiedBy]
 * @param {Function} [options.customFetch=fetch]
 */
export async function logLoaReasonEdited({
  env,
  guildId,
  userId,
  displayName,
  oldReason,
  newReason,
  modifiedBy = null,
  customFetch = fetch,
}) {
  const fields = [
    {
      name: "👤 Staff Member",
      value: `<@${userId}> (${displayName || "Staff"})`,
      inline: true,
    },
    {
      name: "📝 Previous Reason",
      value: oldReason ? `> ${oldReason}` : "*None*",
      inline: false,
    },
    {
      name: "✏️ Updated Reason",
      value: newReason ? `> ${newReason}` : "*None*",
      inline: false,
    },
  ];

  if (modifiedBy && modifiedBy !== userId) {
    fields.push({
      name: "🛡️ Changed By",
      value: `<@${modifiedBy}>`,
      inline: true,
    });
  }

  const embed = {
    title: "✏️ Staff LOA Reason Updated",
    description: `The Leave of Absence reason for <@${userId}> has been updated.`,
    color: VITAL_ORANGE,
    fields,
    thumbnail: { url: VITAL_RP_LOGO_URL },
    footer: {
      text: `Damo Bot • Staff LOA Manager • ${DAMO_BOT_VERSION}`,
    },
    timestamp: new Date().toISOString(),
  };

  await sendLoaLogMessage({ env, embed, customFetch });
}

/**
 * Log when a 24-hour return reminder is successfully dispatched.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {string} options.displayName
 * @param {string} options.endDate
 * @param {Function} [options.customFetch=fetch]
 */
export async function logLoaReminderSent({
  env,
  guildId,
  userId,
  displayName,
  endDate,
  customFetch = fetch,
}) {
  const embed = {
    title: "🔔 24-Hour LOA Return Reminder Sent",
    description: `A direct message reminder was dispatched to <@${userId}> (${displayName || "Staff"}). Scheduled return: **${formatPrettyDate(endDate)}**.`,
    color: 3447003, // Blue (#3498DB)
    fields: [
      {
        name: "👤 Staff Member",
        value: `<@${userId}>`,
        inline: true,
      },
      {
        name: "📅 Expected Return",
        value: formatPrettyDate(endDate),
        inline: true,
      },
    ],
    thumbnail: { url: VITAL_RP_LOGO_URL },
    footer: {
      text: `Damo Bot • Staff LOA Manager • ${DAMO_BOT_VERSION}`,
    },
    timestamp: new Date().toISOString(),
  };

  await sendLoaLogMessage({ env, embed, customFetch });
}

/**
 * Log when a 24-hour return reminder DM could not be delivered.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {string} options.displayName
 * @param {string} options.endDate
 * @param {string} [options.error]
 * @param {Function} [options.customFetch=fetch]
 */
export async function logLoaReminderFailed({
  env,
  guildId,
  userId,
  displayName,
  endDate,
  error = "Direct messages disabled or blocked",
  customFetch = fetch,
}) {
  const embed = {
    title: "⚠️ LOA Reminder DM Delivery Failed",
    description: `Could not deliver 24-hour return reminder DM to <@${userId}> (${displayName || "Staff"}).`,
    color: 15105570, // Orange-Yellow (#E67E22)
    fields: [
      {
        name: "👤 Staff Member",
        value: `<@${userId}>`,
        inline: true,
      },
      {
        name: "📅 Expected Return",
        value: formatPrettyDate(endDate),
        inline: true,
      },
      {
        name: "ℹ️ Reason",
        value: error.includes("50007") || error.toLowerCase().includes("cannot send")
          ? "User has Direct Messages disabled from server members or has blocked the bot."
          : `API Error: ${error}`,
        inline: false,
      },
    ],
    thumbnail: { url: VITAL_RP_LOGO_URL },
    footer: {
      text: `Damo Bot • Staff LOA Manager • ${DAMO_BOT_VERSION}`,
    },
    timestamp: new Date().toISOString(),
  };

  await sendLoaLogMessage({ env, embed, customFetch });
}

