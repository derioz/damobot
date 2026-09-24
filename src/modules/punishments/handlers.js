import {
  InteractionResponseType,
  InteractionResponseFlags,
} from "discord-interactions";
import {
  DEFAULT_PUNISHMENT_LOG_CHANNEL_ID,
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  PunishmentCustomId,
  SyncStatus,
  AuditAction,
  ComponentType,
  ButtonStyle,
  IS_COMPONENTS_V2_FLAG,
  EPHEMERAL_FLAG,
  buildTranscriptReplaceCustomId,
  buildTranscriptCancelCustomId,
  parseTranscriptCustomId,
} from "./constants.js";
import {
  generatePendingToken,
  savePendingReplacementContext,
  getPendingReplacementContext,
  consumePendingReplacementContext,
} from "./pendingState.js";
import {
  formatPunishmentLog,
  createPunishmentActionRow,
  formatPunishmentEmbeds,
  isValidUrl,
} from "./formatter.js";
import {
  buildPunishmentCenterContainer,
  buildUserSelectPrompt,
  buildPunishmentModal,
  buildManualPunishmentModal,
  buildSearchModal,
  buildSearchResultsContainer,
  buildEditPunishmentModal,
  buildEditLinksModal,
  buildAddTicketTranscriptPrompt,
  buildAddToPunishmentSelectorContainer,
  buildTranscriptTypeChoiceContainer,
  buildTranscriptOverwriteWarningContainer,
  buildNoPunishmentRecordsContainer,
} from "./components.js";
import { extractTicketTranscriptUrl, hashString } from "./transcript.js";
import {
  appendPunishmentRecord,
  updatePunishmentSyncStatus,
  searchPunishments,
  getPlayerHistory,
  getRecentPunishments,
  getMyPunishments,
  getPunishmentById,
  updatePunishmentRecord,
  getLatestPunishmentsByDiscordId,
} from "./db.js";

import {
  ephemeralTextResponse,
  ephemeralComponentsResponse,
  updateComponentsResponse,
  deferredUpdateMessageResponse,
  deferredChannelMessageResponse,
  verifyStaffRole,
  getModalValues,
  editOriginalInteractionResponse,
} from "../../shared/index.js";

export {
  ephemeralTextResponse,
  ephemeralComponentsResponse,
  updateComponentsResponse,
  deferredUpdateMessageResponse,
  deferredChannelMessageResponse,
  verifyStaffRole,
  getModalValues,
  editOriginalInteractionResponse,
};

/**
 * Canonical shared handler to open the private Staff Punishment Center.
 * Invoked by both /logpunishment slash command and the sticky button.
 * Enforces strict StaffTeam authorization and responds EPHEMERALLY.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function openPunishmentCenter(interaction, env) {
  const auth = verifyStaffRole(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  const container = buildPunishmentCenterContainer();
  return ephemeralComponentsResponse(container);
}

/**
 * Handle /logpunishment slash command.
 * Responds EPHEMERALLY with the private Staff Punishment Center.
 */
export async function handlePunishmentCommand(interaction, env, ctx) {
  return await openPunishmentCenter(interaction, env);
}

/**
 * Handle User Context Command: "Punishment History"
 * Right click Discord user -> Apps -> Punishment History
 */
export async function handleUserContextPunishmentHistory(interaction, env, ctx) {
  const auth = verifyStaffRole(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  const targetUserId = interaction.data?.target_id;
  if (!targetUserId) {
    return ephemeralTextResponse("❌ Could not identify target user.");
  }

  const resolvedUser = interaction.data?.resolved?.users?.[targetUserId];
  const targetName =
    resolvedUser?.global_name || resolvedUser?.username || targetUserId;

  try {
    const { records } = await getPlayerHistory({
      env,
      discordIdOrName: targetUserId,
    });

    const container = buildSearchResultsContainer({
      title: "⚖️ PLAYER PUNISHMENT HISTORY",
      subtitle: `**${targetName}** (\`${targetUserId}\`)\n${records.length} record(s) on file`,
      records,
      queryKey: targetUserId,
    });

    return ephemeralComponentsResponse(container);
  } catch (err) {
    return ephemeralTextResponse(
      `❌ Error looking up punishment history: ${err.message}`
    );
  }
}

/**
 * Handle Message Context Command: "Add to Punishment"
 * Right click Discord message -> Apps -> Add to Punishment
 *
 * Ephemeral, staff-only workflow.
 * Verifies guild interaction and StaffTeam role.
 * Captures selected TicketTool message information.
 * Asks the staff member which player the transcript belongs to via UserSelect.
 * (DO NOT assume message author is the punished player).
 *
 * @param {Object} interaction
 * @param {Object} env
 * @param {Object} ctx
 * @returns {Promise<Response>}
 */
export async function handleMessageContextAddToPunishment(interaction, env, ctx) {
  const isGuild = Boolean(
    interaction.guild_id || interaction.member?.guild_id
  );

  if (!isGuild) {
    return ephemeralTextResponse(
      "❌ This feature is only available within a server."
    );
  }

  const auth = verifyStaffRole(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  const targetMessageId = interaction.data?.target_id;
  const message = interaction.data?.resolved?.messages?.[targetMessageId];

  if (!targetMessageId || !message) {
    return ephemeralTextResponse(
      "❌ Could not read the selected Discord message."
    );
  }

  const channelId = interaction.channel_id || message.channel_id;
  if (!channelId) {
    return ephemeralTextResponse("❌ Could not identify channel.");
  }

  // Present ephemeral User Select asking which player this transcript belongs to.
  // DO NOT assume message author is the punished player.
  const promptContainer = buildAddTicketTranscriptPrompt({
    channelId,
    messageId: targetMessageId,
  });

  return ephemeralComponentsResponse(promptContainer);
}

/**
 * Execute transcript attachment/replacement onto an existing punishment record.
 * Updates Google Sheets, logs EDITED audit entry, updates Discord message,
 * and responds ephemerally with link button.
 *
 * @param {Object} options
 * @param {Object} options.interaction
 * @param {Object} options.env
 * @param {string} options.punishmentId
 * @param {string} options.transcriptType "report" or "response"
 * @param {string} options.channelId
 * @param {string} options.messageId
 * @param {boolean} options.isReplace
 * @returns {Promise<Response>}
 */
/**
 * In-flight replacement set to prevent duplicate audit rows / race conditions from double clicks.
 */
export const inFlightReplacements = new Set();

/**
 * Process transcript replacement asynchronously after immediate Discord interaction ACK.
 *
 * @param {Object} options
 * @param {Object} options.interaction
 * @param {Object} options.env
 * @param {string} options.transcriptType - "report" | "response"
 * @param {string} options.punishmentId
 * @param {string} options.channelId
 * @param {string} options.messageId
 * @param {string} [options.expectedUrl]
 * @param {string} [options.expectedHash]
 * @returns {Promise<void>}
 */
export async function processTranscriptReplacement({
  interaction,
  env,
  transcriptType,
  punishmentId,
  channelId,
  messageId,
  expectedUrl,
  expectedHash,
}) {
  const typeLabel = transcriptType === "report" ? "Report" : "Response";

  try {
    // 1. Re-fetch the punishment record to guarantee current state
    const record = await getPunishmentById({ env, punishmentId });
    if (!record) {
      await editOriginalInteractionResponse({
        interaction,
        env,
        content:
          `❌ **Transcript Update Failed**\n\n` +
          `Punishment record \`${punishmentId}\` was not found.\n\n` +
          `The punishment record was not changed.\n` +
          `Please try again.`,
      });
      return;
    }

    // 2. Stale confirmation protection: verify URL has not changed since confirmation was shown
    const currentUrl =
      transcriptType === "report"
        ? (record.reportUrl || "").trim()
        : (record.responseUrl || "").trim();

    const isStale =
      (expectedUrl !== undefined && expectedUrl !== currentUrl) ||
      (expectedHash && expectedHash !== hashString(currentUrl));

    if (isStale) {
      await editOriginalInteractionResponse({
        interaction,
        env,
        content:
          `⚠️ **Record Changed**\n\n` +
          `Someone updated this transcript after you opened this confirmation.\n\n` +
          `Please reopen the punishment and try again.`,
      });
      return;
    }

    // 3. Resolve replacement transcript URL from selected TicketTool message
    const guildId =
      interaction.guild_id ||
      interaction.member?.guild_id ||
      env.DISCORD_GUILD_ID ||
      "";
    const jumpUrl = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
    let transcriptUrl = jumpUrl;

    if (channelId && messageId && env.DISCORD_BOT_TOKEN) {
      try {
        const msgRes = await fetch(
          `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            },
          }
        );
        if (msgRes.ok) {
          const msg = await msgRes.json();
          transcriptUrl = extractTicketTranscriptUrl(msg, jumpUrl);
        }
      } catch (err) {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.warn("Failed to fetch Discord message for transcript URL:", err);
        }
      }
    }

    // 4. Staff Info
    const staffUser = interaction.member?.user || interaction.user;
    const staffInfo = {
      id: staffUser?.id || "0",
      name:
        interaction.member?.nick ||
        staffUser?.global_name ||
        staffUser?.username ||
        "Staff",
    };

    const auditDetail =
      transcriptType === "report"
        ? "Replaced Report Transcript"
        : "Replaced Response Transcript";

    const updatedFields =
      transcriptType === "report"
        ? { reportUrl: transcriptUrl }
        : { responseUrl: transcriptUrl };

    // 5. Update SAME Punishment Logs row & append ONE EDITED row to Punishment Audits
    const { updatedRecord } = await updatePunishmentRecord({
      env,
      punishmentId,
      updatedFields,
      staffInfo,
      auditDetails: auditDetail,
    });

    // 6. Edit SAME original #banwarnlog punishment message (preserving ID, logMessageId, jumpUrl)
    const logChannelId =
      updatedRecord.logChannelId ||
      env.PUNISHMENT_LOG_CHANNEL_ID ||
      DEFAULT_PUNISHMENT_LOG_CHANNEL_ID;
    const logMessageId = updatedRecord.logMessageId;
    let discordEditFailed = false;
    let discordErrText = "";

    if (logMessageId && logChannelId && env.DISCORD_BOT_TOKEN) {
      const newContent = formatPunishmentLog(updatedRecord);
      const newActionRows = createPunishmentActionRow(updatedRecord);
      const newEmbeds = formatPunishmentEmbeds(updatedRecord);

      const patchPayload = {
        content: newContent,
        components: newActionRows,
      };
      if (newEmbeds.length > 0) {
        patchPayload.embeds = newEmbeds;
      }

      const patchUrl = `https://discord.com/api/v10/channels/${logChannelId}/messages/${logMessageId}`;
      try {
        const patchRes = await fetch(patchUrl, {
          method: "PATCH",
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(patchPayload),
        });

        if (!patchRes.ok) {
          discordEditFailed = true;
          discordErrText = await patchRes.text().catch(() => "");
          if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
            console.warn(
              `Failed to PATCH Discord punishment message: ${discordErrText}`
            );
          }
        }
      } catch (err) {
        discordEditFailed = true;
        discordErrText = err.message;
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.warn(
            `Network error patching Discord punishment message: ${err.message}`
          );
        }
      }
    }

    // 7. Discord post failure handling (mark sync status POST_FAILED and notify staff)
    if (discordEditFailed) {
      if (updatedRecord.rowIndex) {
        await updatePunishmentSyncStatus({
          env,
          rowIndex: updatedRecord.rowIndex,
          logMessageId: updatedRecord.logMessageId || "",
          discordJumpUrl: updatedRecord.discordJumpUrl || "",
          syncStatus: SyncStatus.POST_FAILED,
          staffInfo,
          punishmentId,
        }).catch((err) => {
          if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
            console.warn("Failed to mark sync status as POST_FAILED:", err);
          }
        });
      }

      const buttons = [];
      if (
        updatedRecord.discordJumpUrl &&
        isValidUrl(updatedRecord.discordJumpUrl)
      ) {
        buttons.push({
          type: ComponentType.BUTTON,
          style: ButtonStyle.LINK,
          url: updatedRecord.discordJumpUrl,
          label: "View Punishment",
          emoji: { name: "🔗" },
        });
      }

      await editOriginalInteractionResponse({
        interaction,
        env,
        content:
          `⚠️ **Transcript Updated (Discord Sync Needed)**\n\n` +
          `\`${punishmentId}\` was successfully updated in the database, but editing the Discord message in <#${logChannelId}> failed.\n` +
          `**Error:** ${discordErrText || "Discord API error"}\n\n` +
          `The record has been marked as \`Post Failed\` in the database. Contact an administrator to retry syncing.${updatedRecord.discordJumpUrl ? `\n\n[🔗 View Original Log](${updatedRecord.discordJumpUrl})` : ""}`,
        components:
          buttons.length > 0
            ? [{ type: ComponentType.ACTION_ROW, components: buttons }]
            : [],
      });
      return;
    }

    // 8. Success Response: Compact ephemeral success UI with [ 🔗 View Punishment ]
    const buttons = [];
    if (
      updatedRecord.discordJumpUrl &&
      isValidUrl(updatedRecord.discordJumpUrl)
    ) {
      buttons.push({
        type: ComponentType.BUTTON,
        style: ButtonStyle.LINK,
        url: updatedRecord.discordJumpUrl,
        label: "View Punishment",
        emoji: { name: "🔗" },
      });
    }

    const successContent =
      `✅ **${typeLabel} Transcript Updated**\n\n` +
      `\`${punishmentId}\` now links to the new ${typeLabel} Transcript.`;

    await editOriginalInteractionResponse({
      interaction,
      env,
      content: successContent,
      components:
        buttons.length > 0
          ? [{ type: ComponentType.ACTION_ROW, components: buttons }]
          : [],
    });
  } catch (err) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.error("Error during transcript replacement:", err);
    }
    await editOriginalInteractionResponse({
      interaction,
      env,
      content:
        `❌ **Transcript Update Failed**\n\n` +
        `The punishment record was not changed.\n\n` +
        `Please try again.`,
    });
  }
}

async function executeAttachTranscript({
  interaction,
  env,
  punishmentId,
  transcriptType,
  channelId,
  messageId,
  isReplace,
}) {
  const guildId =
    interaction.guild_id ||
    interaction.member?.guild_id ||
    env.DISCORD_GUILD_ID ||
    "";
  const jumpUrl = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
  let transcriptUrl = jumpUrl;

  // Safely fetch message from Discord API to prefer direct TicketTool transcript URL if available
  if (channelId && messageId && env.DISCORD_BOT_TOKEN) {
    try {
      const msgRes = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          },
        }
      );
      if (msgRes.ok) {
        const msg = await msgRes.json();
        transcriptUrl = extractTicketTranscriptUrl(msg, jumpUrl);
      }
    } catch (err) {
      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.warn("Failed to fetch Discord message for transcript URL:", err);
      }
    }
  }

  const staffUser = interaction.member?.user || interaction.user;
  const staffInfo = {
    id: staffUser?.id || "0",
    name:
      interaction.member?.nick ||
      staffUser?.global_name ||
      staffUser?.username ||
      "Staff",
  };

  const detail =
    transcriptType === "report"
      ? isReplace
        ? "Replaced Report Transcript"
        : "Added Report Transcript"
      : isReplace
      ? "Replaced Response Transcript"
      : "Added Response Transcript";

  const updatedFields =
    transcriptType === "report"
      ? { reportUrl: transcriptUrl }
      : { responseUrl: transcriptUrl };

  try {
    // 1. Update Google Sheets row & append EDITED to Punishment Audits
    const { updatedRecord } = await updatePunishmentRecord({
      env,
      punishmentId,
      updatedFields,
      staffInfo,
      auditDetails: detail,
    });

    // 2. Edit original Discord message in #banwarnlog if logMessageId exists
    const logChannelId =
      updatedRecord.logChannelId ||
      env.PUNISHMENT_LOG_CHANNEL_ID ||
      DEFAULT_PUNISHMENT_LOG_CHANNEL_ID;
    const logMessageId = updatedRecord.logMessageId;

    if (logMessageId && logChannelId && env.DISCORD_BOT_TOKEN) {
      const newContent = formatPunishmentLog(updatedRecord);
      const newActionRows = createPunishmentActionRow(updatedRecord);
      const newEmbeds = formatPunishmentEmbeds(updatedRecord);

      const patchPayload = {
        content: newContent,
        components: newActionRows,
      };
      if (newEmbeds.length > 0) {
        patchPayload.embeds = newEmbeds;
      }

      const patchUrl = `https://discord.com/api/v10/channels/${logChannelId}/messages/${logMessageId}`;
      await fetch(patchUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchPayload),
      }).catch((err) => {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.warn(`Failed to PATCH Discord punishment message: ${err.message}`);
        }
      });
    }

    // 3. Respond privately to the staff member via deferred webhook edit
    const buttons = [];
    if (
      updatedRecord.discordJumpUrl &&
      isValidUrl(updatedRecord.discordJumpUrl)
    ) {
      buttons.push({
        type: ComponentType.BUTTON,
        style: ButtonStyle.LINK,
        url: updatedRecord.discordJumpUrl,
        label: "View Punishment",
        emoji: { name: "🔗" },
      });
    }

    const typeLabel = transcriptType === "report" ? "Report" : "Response";

    await editOriginalInteractionResponse({
      interaction,
      env,
      content: `✅ **Transcript Added**\n\n${typeLabel} Transcript added to \`${punishmentId}\`.`,
      components:
        buttons.length > 0
          ? [{ type: ComponentType.ACTION_ROW, components: buttons }]
          : [],
    });
  } catch (err) {
    if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
      console.error(`Failed to attach transcript to ${punishmentId}:`, err);
    }
    await editOriginalInteractionResponse({
      interaction,
      env,
      content: `❌ **Failed to attach transcript:** ${err.message}`,
      components: [],
    });
  }
}

/**
 * Handle message component interactions (Buttons, Select Menus).
 */
export async function handlePunishmentComponent(interaction, env, ctx) {
  const auth = verifyStaffRole(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  const customId = interaction.data?.custom_id || "";

  // 1. [ ➕ Log Punishment ] Button
  if (customId === PunishmentCustomId.BTN_LOG) {
    const promptContainer = buildUserSelectPrompt();
    return ephemeralComponentsResponse(promptContainer);
  }

  // 2. UserSelect menu interaction
  if (customId === PunishmentCustomId.USER_SELECT) {
    const selectedUserId = interaction.data?.values?.[0];
    if (!selectedUserId) {
      return ephemeralTextResponse("❌ No user selected.");
    }

    const resolvedMember = interaction.data?.resolved?.members?.[selectedUserId];
    const resolvedUser = interaction.data?.resolved?.users?.[selectedUserId];
    const displayName =
      resolvedMember?.nick ||
      resolvedUser?.global_name ||
      resolvedUser?.username ||
      "";

    const modal = buildPunishmentModal({
      userId: selectedUserId,
      displayName,
    });

    return new Response(
      JSON.stringify({
        type: InteractionResponseType.MODAL,
        data: modal,
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  // 3. [ ✏️ Manual Entry ] Button
  if (customId === PunishmentCustomId.BTN_MANUAL) {
    const modal = buildManualPunishmentModal();
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.MODAL,
        data: modal,
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  // 4. [ ❌ Cancel / Dismiss ] Button
  if (customId === PunishmentCustomId.BTN_DISMISS) {
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: "Action cancelled.",
          components: [],
        },
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  // 4b. Add to Punishment - Cancel Transcript Replacement
  const parsedCancel = parseTranscriptCustomId(customId);
  if (
    parsedCancel?.action === "cancel" ||
    parsedCancel?.action === "legacy_cancel" ||
    customId.startsWith(PunishmentCustomId.BTN_CANCEL_REPLACE_PREFIX) ||
    customId === PunishmentCustomId.BTN_CANCEL_REPLACE
  ) {
    let punishmentId = "";
    const token = parsedCancel?.token;
    if (token) {
      const context = await getPendingReplacementContext({ env, token });
      if (context) {
        // Enforce ownership: only the staff member who initiated can cancel
        const invokingUserId =
          interaction.member?.user?.id || interaction.user?.id || "";
        if (context.staffUserId && context.staffUserId !== invokingUserId) {
          return ephemeralTextResponse(
            "❌ Only the staff member who initiated this confirmation can cancel it."
          );
        }
        punishmentId = context.punishmentId || "";
        await consumePendingReplacementContext({ env, token });
      }
    }

    const messageContent = punishmentId
      ? `❌ **Transcript replacement cancelled.**\n\nNo changes were made to \`${punishmentId}\`.`
      : "❌ **Transcript replacement cancelled.**\n\nNo changes were made.";

    return new Response(
      JSON.stringify({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: messageContent,
          components: [],
        },
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  // 5. [ 🔎 Search History ] Button
  if (customId === PunishmentCustomId.BTN_SEARCH) {
    const modal = buildSearchModal();
    return new Response(
      JSON.stringify({
        type: InteractionResponseType.MODAL,
        data: modal,
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  // 6. [ 🕘 Recent Logs ] Button
  if (customId === PunishmentCustomId.BTN_RECENT) {
    try {
      const records = await getRecentPunishments({ env, limit: 10 });
      const safeRecords = Array.isArray(records) ? records : [];
      const subtitle =
        safeRecords.length > 0
          ? `Showing the latest ${safeRecords.length} punishment record(s)`
          : "No recent punishment records found";

      const container = buildSearchResultsContainer({
        title: "🕘 RECENT PUNISHMENT LOGS",
        subtitle,
        records: safeRecords,
        queryKey: "recent",
      });

      return ephemeralComponentsResponse(container);
    } catch (err) {
      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.error(
          "[recent-logs] failed to retrieve recent punishments:",
          err?.message || err
        );
      }
      return ephemeralTextResponse(
        `❌ **Error retrieving recent punishments:** ${err.message || "Failed to query punishment logs. Please try again."}`
      );
    }
  }

  // 7. [ 👤 My Logs ] Button
  if (customId === PunishmentCustomId.BTN_MY_LOGS) {
    const staffId = interaction.member?.user?.id || interaction.user?.id;
    try {
      const records = await getMyPunishments({
        env,
        staffDiscordId: staffId,
        limit: 10,
      });
      const container = buildSearchResultsContainer({
        title: "👤 MY PUNISHMENT LOGS",
        subtitle: `Showing your latest ${records.length} logged punishment(s)`,
        records,
        queryKey: `my:${staffId}`,
      });
      return ephemeralComponentsResponse(container);
    } catch (err) {
      return ephemeralTextResponse(
        `❌ Error retrieving your logs: ${err.message}`
      );
    }
  }

  // 8. [ 👤 Player History ] Button under log or result card
  if (customId.startsWith(PunishmentCustomId.BTN_PLAYER_HISTORY_PREFIX)) {
    const key = customId.slice(PunishmentCustomId.BTN_PLAYER_HISTORY_PREFIX.length);
    try {
      const { records, isNameFallback } = await getPlayerHistory({
        env,
        discordIdOrName: key,
      });

      const note = isNameFallback
        ? `⚠️ Showing name-based matches for "${key}" (no Discord ID on record)`
        : `Showing records for Discord ID \`${key}\``;

      const container = buildSearchResultsContainer({
        title: "👤 PLAYER PUNISHMENT HISTORY",
        subtitle: `${note}\n${records.length} record(s) found`,
        records,
        queryKey: key,
      });

      return ephemeralComponentsResponse(container);
    } catch (err) {
      return ephemeralTextResponse(
        `❌ Error retrieving player history: ${err.message}`
      );
    }
  }

  // 9. Pagination buttons
  if (customId.startsWith(PunishmentCustomId.BTN_PAGE_PREFIX)) {
    const raw = customId.slice(PunishmentCustomId.BTN_PAGE_PREFIX.length);
    const colonIdx = raw.indexOf(":");
    const pageNum = parseInt(raw.slice(0, colonIdx), 10) || 1;
    const queryKey = decodeURIComponent(raw.slice(colonIdx + 1));

    try {
      let records = [];
      let title = "🔎 PUNISHMENT SEARCH RESULTS";
      let subtitle = `Query: "${queryKey}"`;

      if (queryKey === "recent") {
        records = await getRecentPunishments({ env, limit: 30 });
        title = "🕘 RECENT PUNISHMENT LOGS";
        subtitle = "Showing recent records";
      } else if (queryKey.startsWith("my:")) {
        const staffId = queryKey.slice(3);
        records = await getMyPunishments({ env, staffDiscordId: staffId, limit: 30 });
        title = "👤 MY PUNISHMENT LOGS";
        subtitle = "Showing your logged punishments";
      } else {
        records = await searchPunishments({ env, query: queryKey });
      }

      const container = buildSearchResultsContainer({
        title,
        subtitle,
        records,
        page: pageNum,
        queryKey,
      });

      return updateComponentsResponse(container);
    } catch (err) {
      return ephemeralTextResponse(`❌ Pagination error: ${err.message}`);
    }
  }

  // 10. [ ✏️ Edit Record ] Button
  if (customId.startsWith(PunishmentCustomId.BTN_EDIT_PREFIX)) {
    const punishmentId = customId.slice(PunishmentCustomId.BTN_EDIT_PREFIX.length);
    try {
      const record = await getPunishmentById({ env, punishmentId });
      if (!record) {
        return ephemeralTextResponse(`❌ Punishment record '${punishmentId}' not found.`);
      }
      const modal = buildEditPunishmentModal(record);
      return new Response(
        JSON.stringify({
          type: InteractionResponseType.MODAL,
          data: modal,
        }),
        { headers: { "content-type": "application/json" } }
      );
    } catch (err) {
      return ephemeralTextResponse(`❌ Error loading record: ${err.message}`);
    }
  }

  // 11. [ 📎 Links & Evidence ] Button
  if (customId.startsWith(PunishmentCustomId.BTN_LINKS_PREFIX)) {
    const punishmentId = customId.slice(PunishmentCustomId.BTN_LINKS_PREFIX.length);
    try {
      const record = await getPunishmentById({ env, punishmentId });
      if (!record) {
        return ephemeralTextResponse(`❌ Punishment record '${punishmentId}' not found.`);
      }
      const modal = buildEditLinksModal(record);
      return new Response(
        JSON.stringify({
          type: InteractionResponseType.MODAL,
          data: modal,
        }),
        { headers: { "content-type": "application/json" } }
      );
    } catch (err) {
      return ephemeralTextResponse(`❌ Error loading record: ${err.message}`);
    }
  }

  // 12. Add to Punishment - Staff selected player for TicketTool transcript
  if (customId.startsWith(PunishmentCustomId.USER_SELECT_TRANSCRIPT_PREFIX)) {
    const rawPayload = customId.slice(
      PunishmentCustomId.USER_SELECT_TRANSCRIPT_PREFIX.length
    );
    const [channelId, messageId] = rawPayload.split(":");
    const selectedPlayerId = interaction.data?.values?.[0];

    if (!selectedPlayerId) {
      return ephemeralTextResponse("❌ No player selected.");
    }

    const resolvedMember =
      interaction.data?.resolved?.members?.[selectedPlayerId];
    const resolvedUser = interaction.data?.resolved?.users?.[selectedPlayerId];
    const playerName =
      resolvedMember?.nick ||
      resolvedUser?.global_name ||
      resolvedUser?.username ||
      "Unknown Player";

    try {
      const { records, totalCount } = await getLatestPunishmentsByDiscordId({
        env,
        playerDiscordId: selectedPlayerId,
        limit: 5,
      });

      if (records.length === 0) {
        const noRecordsContainer = buildNoPunishmentRecordsContainer({
          playerId: selectedPlayerId,
          playerName,
          channelId,
          messageId,
        });
        return updateComponentsResponse(noRecordsContainer);
      }

      const selectorContainer = buildAddToPunishmentSelectorContainer({
        player: { id: selectedPlayerId, name: playerName },
        records,
        totalCount,
        channelId,
        messageId,
      });

      return updateComponentsResponse(selectorContainer);
    } catch (err) {
      return ephemeralTextResponse(
        `❌ Error looking up player punishment history: ${err.message}`
      );
    }
  }

  // 13. Add to Punishment - Select Menu selection
  if (customId.startsWith(PunishmentCustomId.SELECT_ADD_TRANSCRIPT_PREFIX)) {
    const rawPayload = customId.slice(
      PunishmentCustomId.SELECT_ADD_TRANSCRIPT_PREFIX.length
    );
    const [expectedPlayerId, channelId, messageId] = rawPayload.split(":");
    const selectedPunishmentId = interaction.data?.values?.[0];

    if (!selectedPunishmentId) {
      return ephemeralTextResponse("❌ No punishment record selected.");
    }

    try {
      const record = await getPunishmentById({
        env,
        punishmentId: selectedPunishmentId,
      });
      if (!record) {
        return ephemeralTextResponse(
          `❌ Punishment record '${selectedPunishmentId}' not found.`
        );
      }

      // Security: ensure record still belongs to expected player Discord ID
      if (
        expectedPlayerId &&
        String(record.playerDiscordId || "").trim() !== expectedPlayerId
      ) {
        return ephemeralTextResponse(
          `❌ Punishment record '${selectedPunishmentId}' does not belong to the expected player.`
        );
      }

      const choiceContainer = buildTranscriptTypeChoiceContainer({
        punishmentId: selectedPunishmentId,
        playerName: record.playerName,
        punishment: record.punishment,
        punishmentLength: record.punishmentLength,
        channelId,
        messageId,
      });

      return updateComponentsResponse(choiceContainer);
    } catch (err) {
      return ephemeralTextResponse(`❌ Error loading record: ${err.message}`);
    }
  }

  // 14. Add to Punishment - Choose Transcript Type (Report or Response)
  if (customId.startsWith(PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX)) {
    const rawPayload = customId.slice(
      PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX.length
    );
    const [transcriptType, punishmentId, channelId, messageId] =
      rawPayload.split(":");

    try {
      const record = await getPunishmentById({ env, punishmentId });
      if (!record) {
        return ephemeralTextResponse(
          `❌ Punishment record '${punishmentId}' not found.`
        );
      }

      const staffUserId =
        interaction.member?.user?.id || interaction.user?.id || "";

      // Existing Transcript Protection check
      if (
        transcriptType === "report" &&
        record.reportUrl &&
        record.reportUrl.trim()
      ) {
        const existingUrl = record.reportUrl.trim();
        const token = generatePendingToken();
        const context = {
          staffUserId,
          punishmentId,
          transcriptType: "report",
          existingUrl,
          channelId,
          messageId,
          createdAt: Date.now(),
        };
        await savePendingReplacementContext({ env, token, context });

        const warning = buildTranscriptOverwriteWarningContainer({
          punishmentId,
          transcriptType: "report",
          existingUrl,
          channelId,
          messageId,
          token,
        });
        return updateComponentsResponse(warning);
      }

      if (
        transcriptType === "response" &&
        record.responseUrl &&
        record.responseUrl.trim()
      ) {
        const existingUrl = record.responseUrl.trim();
        const token = generatePendingToken();
        const context = {
          staffUserId,
          punishmentId,
          transcriptType: "response",
          existingUrl,
          channelId,
          messageId,
          createdAt: Date.now(),
        };
        await savePendingReplacementContext({ env, token, context });

        const warning = buildTranscriptOverwriteWarningContainer({
          punishmentId,
          transcriptType: "response",
          existingUrl,
          channelId,
          messageId,
          token,
        });
        return updateComponentsResponse(warning);
      }

      // Record does not have existing transcript: acknowledge immediately (type 6) and attach in background
      const lockKey = `${punishmentId}:${transcriptType}`;
      if (inFlightReplacements.has(lockKey)) {
        return deferredUpdateMessageResponse();
      }
      inFlightReplacements.add(lockKey);

      const task = executeAttachTranscript({
        interaction,
        env,
        punishmentId,
        transcriptType,
        channelId,
        messageId,
        isReplace: false,
      })
        .then(() => {})
        .catch((err) => {
          if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
            console.error(`[component] attachment failed for ${punishmentId}:`, err);
          }
        })
        .finally(() => {
          inFlightReplacements.delete(lockKey);
        });

      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(task);
      }

      return deferredUpdateMessageResponse();
    } catch (err) {
      return ephemeralTextResponse(`❌ Error: ${err.message}`);
    }
  }

  // 15. Add to Punishment - Confirm Overwrite / Replace Transcript (Immediate ACK)
  const parsedReplace = parseTranscriptCustomId(customId);
  if (
    parsedReplace?.action === "replace" ||
    customId.startsWith(PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX) ||
    customId.startsWith(PunishmentCustomId.LEGACY_CONFIRM_REPLACE_PREFIX)
  ) {
    let transcriptType = "";
    let punishmentId = "";
    let channelId = "";
    let messageId = "";
    let expectedUrl = undefined;
    let expectedHash = undefined;
    const token = parsedReplace?.token;

    if (token) {
      // Look up pending state from Durable Object
      const pendingContext = await getPendingReplacementContext({ env, token });
      if (!pendingContext) {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.warn(
            `[component] action=transcript_replace token=${token} status=expired`
          );
        }
        return new Response(
          JSON.stringify({
            type: InteractionResponseType.UPDATE_MESSAGE,
            data: {
              content:
                "⚠️ **Confirmation Expired**\n\nPlease use Add to Punishment again.",
              components: [],
            },
          }),
          { headers: { "content-type": "application/json" } }
        );
      }

      // Enforce ownership: only the staff member who initiated can confirm
      const invokingUserId =
        interaction.member?.user?.id || interaction.user?.id || "";
      if (
        pendingContext.staffUserId &&
        pendingContext.staffUserId !== invokingUserId
      ) {
        return ephemeralTextResponse(
          "❌ Only the staff member who initiated this replacement can confirm it."
        );
      }

      transcriptType = pendingContext.transcriptType;
      punishmentId = pendingContext.punishmentId;
      channelId = pendingContext.channelId;
      messageId = pendingContext.messageId;
      expectedUrl = pendingContext.existingUrl;

      // Atomically consume the token to prevent double-execution
      await consumePendingReplacementContext({ env, token });
    } else {
      // Legacy format fallback: punish_att_confirm:type:id:channel:message:hash
      const rawPayload = customId.slice(
        customId.startsWith(PunishmentCustomId.LEGACY_CONFIRM_REPLACE_PREFIX)
          ? PunishmentCustomId.LEGACY_CONFIRM_REPLACE_PREFIX.length
          : PunishmentCustomId.BTN_CONFIRM_REPLACE_PREFIX.length
      );
      const [legacyType, legacyId, legacyChannel, legacyMessage, legacyHash] =
        rawPayload.split(":");
      transcriptType = legacyType;
      punishmentId = legacyId;
      channelId = legacyChannel;
      messageId = legacyMessage;
      expectedHash = legacyHash;
    }

    const lockKey = `${punishmentId}:${transcriptType}`;
    if (inFlightReplacements.has(lockKey)) {
      return deferredUpdateMessageResponse();
    }
    inFlightReplacements.add(lockKey);

    const task = processTranscriptReplacement({
      interaction,
      env,
      transcriptType,
      punishmentId,
      channelId,
      messageId,
      expectedUrl,
      expectedHash,
    })
      .then(() => {})
      .catch((err) => {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.error(
            `[component] replacement failed for ${punishmentId}:`,
            err
          );
        }
      })
      .finally(() => {
        inFlightReplacements.delete(lockKey);
      });

    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(task);
    }

    return deferredUpdateMessageResponse();
  }

  // 16. Add to Punishment - Create New Punishment with message transcript attached
  if (customId.startsWith(PunishmentCustomId.BTN_CREATE_WITH_MSG_PREFIX)) {
    const rawPayload = customId.slice(
      PunishmentCustomId.BTN_CREATE_WITH_MSG_PREFIX.length
    );
    const [playerId, channelId, messageId] = rawPayload.split(":");

    const resolvedUser =
      interaction.data?.resolved?.users?.[playerId] ||
      interaction.member?.user ||
      interaction.user;
    const displayName =
      resolvedUser?.global_name || resolvedUser?.username || "";

    const modal = buildPunishmentModal({
      userId: playerId,
      displayName,
    });

    // Encode playerId, channelId, and messageId into modal custom_id
    modal.custom_id = `${PunishmentCustomId.MODAL_CREATE_WITH_MSG_PREFIX}${playerId}:${channelId}:${messageId}`;

    return new Response(
      JSON.stringify({
        type: InteractionResponseType.MODAL,
        data: modal,
      }),
      { headers: { "content-type": "application/json" } }
    );
  }

  const safePrefix = customId.split(":")[0] || customId.slice(0, 20);
  if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
    console.warn(`[component] unknown custom_id prefix=${safePrefix}`);
  }
  return ephemeralTextResponse(
    "❌ **This action is no longer valid.**\n\nPlease reopen the Punishment Center and try again."
  );
}

/**
 * Handle Modal Submit interactions.
 */
export async function handlePunishmentModalSubmit(interaction, env, ctx) {
  const auth = verifyStaffRole(interaction, env);
  if (!auth.isStaff) return auth.errorResponse;

  const customId = interaction.data?.custom_id || "";

  // 1. Search Query modal submission
  if (customId === PunishmentCustomId.MODAL_SEARCH) {
    const values = getModalValues(interaction.data?.components || []);
    const query = (values.search_query || "").trim();

    if (!query) {
      return ephemeralTextResponse("❌ Search query cannot be empty.");
    }

    try {
      const records = await searchPunishments({ env, query });
      const container = buildSearchResultsContainer({
        title: "🔎 PUNISHMENT SEARCH RESULTS",
        subtitle: `Query: "${query}" • ${records.length} record(s) found`,
        records,
        queryKey: query,
      });

      return ephemeralComponentsResponse(container);
    } catch (err) {
      return ephemeralTextResponse(`❌ Search error: ${err.message}`);
    }
  }

  // 2. Punishment Log modal submission (standard or create-with-message)
  if (
    customId.startsWith(PunishmentCustomId.MODAL_SUBMIT_PREFIX) ||
    customId.startsWith(PunishmentCustomId.MODAL_CREATE_WITH_MSG_PREFIX)
  ) {
    const isFromMessage = customId.startsWith(
      PunishmentCustomId.MODAL_CREATE_WITH_MSG_PREFIX
    );

    let targetUserIdOrManual = "";
    let autoReportUrl = "";

    if (isFromMessage) {
      const rawPayload = customId.slice(
        PunishmentCustomId.MODAL_CREATE_WITH_MSG_PREFIX.length
      );
      const [playerId, channelId, messageId] = rawPayload.split(":");
      targetUserIdOrManual = playerId;
      const guildId =
        interaction.guild_id ||
        interaction.member?.guild_id ||
        env.DISCORD_GUILD_ID ||
        "";
      if (guildId && channelId && messageId) {
        const jumpUrl = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
        autoReportUrl = jumpUrl;
        if (env.DISCORD_BOT_TOKEN) {
          try {
            const msgRes = await fetch(
              `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
              {
                method: "GET",
                headers: {
                  Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
                },
              }
            );
            if (msgRes.ok) {
              const msg = await msgRes.json();
              autoReportUrl = extractTicketTranscriptUrl(msg, jumpUrl);
            }
          } catch (e) {
            if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
              console.warn("Failed to fetch Discord message for transcript URL:", e);
            }
          }
        }
      }
    } else {
      targetUserIdOrManual = customId.slice(
        PunishmentCustomId.MODAL_SUBMIT_PREFIX.length
      );
    }

    const values = getModalValues(interaction.data?.components || []);

    const playerName = (values.player_name || "").trim();
    const punishment = (values.punishment || "").trim();
    const punishmentLength = (values.punishment_length || "").trim();
    const reason = (values.reason || "").trim();
    const additionalInfo = (values.additional_info || "").trim();
    const reportUrl = autoReportUrl || (values.report_url || "").trim();
    const responseUrl = (values.response_url || "").trim();
    let evidenceImageUrl = (values.evidence_image_url || "").trim();

    // Check for uploaded files in interaction resolved attachments
    if (interaction.data?.resolved?.attachments) {
      const resolvedAttachments = interaction.data.resolved.attachments;
      const fileIds = Array.isArray(values.evidence_image)
        ? values.evidence_image
        : Array.isArray(values.evidence_image_url)
        ? values.evidence_image_url
        : null;

      if (fileIds && fileIds.length > 0 && resolvedAttachments[fileIds[0]]) {
        const fileObj = resolvedAttachments[fileIds[0]];
        evidenceImageUrl = fileObj.url || fileObj.proxy_url || evidenceImageUrl;
      } else {
        const atts = Object.values(resolvedAttachments);
        if (atts.length > 0 && atts[0]) {
          evidenceImageUrl = atts[0].url || atts[0].proxy_url || evidenceImageUrl;
        }
      }
    }

    // Player Discord ID: either from selection or manual input
    let playerDiscordId = targetUserIdOrManual !== "manual"
      ? targetUserIdOrManual
      : (values.player_discord_id || "").trim();

    if (!playerDiscordId) {
      playerDiscordId = "N/A";
    }

    // Required fields validation
    if (!playerName) {
      return ephemeralTextResponse("❌ Player / Character Name is required.");
    }
    if (!punishment) {
      return ephemeralTextResponse("❌ Punishment is required.");
    }
    if (!reason) {
      return ephemeralTextResponse("❌ Reason is required.");
    }

    // Extract staff info
    const staffUser = interaction.member?.user || interaction.user;
    const staffDiscordId = staffUser?.id || "0";
    const staffName =
      interaction.member?.nick ||
      staffUser?.global_name ||
      staffUser?.username ||
      "Staff";

    const guildId =
      interaction.guild_id ||
      interaction.member?.guild_id ||
      env.DISCORD_GUILD_ID ||
      "";
    const logChannelId =
      env.PUNISHMENT_LOG_CHANNEL_ID || DEFAULT_PUNISHMENT_LOG_CHANNEL_ID;

    // 1. Allocate unique Punishment ID via Durable Object
    let punishmentId = `VRP-P-${String(Date.now()).slice(-6)}`;
    if (env.PUNISHMENT_SEQUENCE) {
      try {
        const doId = env.PUNISHMENT_SEQUENCE.idFromName("global");
        const stub = env.PUNISHMENT_SEQUENCE.get(doId);
        const allocRes = await stub.fetch("https://do/sequence/next", {
          method: "POST",
        });
        if (allocRes.ok) {
          const allocData = await allocRes.json();
          if (allocData.punishmentId) {
            punishmentId = allocData.punishmentId;
          }
        }
      } catch (allocErr) {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.warn("Failed to allocate ID from DO, using fallback:", allocErr.message);
        }
      }
    }

    const record = {
      punishmentId,
      createdAt: new Date().toISOString(),
      playerName,
      playerDiscordId,
      punishment,
      punishmentLength,
      reason,
      additionalInfo,
      reportUrl,
      responseUrl,
      evidenceImageUrl,
      staffName,
      staffDiscordId,
      guildId,
      logChannelId,
      logMessageId: "",
      discordJumpUrl: "",
      syncStatus: SyncStatus.PENDING,
    };

    // 2. Append to Google Sheets with Sync Status = Pending
    let sheetRowIndex = -1;
    try {
      const appendResult = await appendPunishmentRecord({ env, record });
      sheetRowIndex = appendResult.rowIndex;
    } catch (sheetErr) {
      if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
        console.error("Failed to append punishment to database:", sheetErr);
      }
      return ephemeralTextResponse(
        `❌ Database Error: Failed to write punishment record to database (${sheetErr.message}). The punishment was not logged.`
      );
    }

    // 3. Post normal searchable Discord markdown message into #banwarnlog
    const messageContent = formatPunishmentLog(record);
    const actionRows = createPunishmentActionRow(record);
    const embeds = formatPunishmentEmbeds(record);

    let postSuccess = false;
    let logMessageId = "";
    let jumpUrl = "";
    let postErrorText = "";

    try {
      const postUrl = `https://discord.com/api/v10/channels/${logChannelId}/messages`;
      const postPayload = {
        content: messageContent,
        components: actionRows,
      };
      if (embeds.length > 0) {
        postPayload.embeds = embeds;
      }

      const postRes = await fetch(postUrl, {
        method: "POST",
        headers: {
          Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(postPayload),
      });

      if (postRes.ok) {
        const msgData = await postRes.json();
        logMessageId = msgData.id;
        jumpUrl = `https://discord.com/channels/${guildId}/${logChannelId}/${logMessageId}`;
        postSuccess = true;
      } else {
        postErrorText = await postRes.text();
      }
    } catch (postErr) {
      postErrorText = postErr.message;
    }

    // 4. Update Google Sheet with message ID, jump URL, and sync status
    if (postSuccess) {
      await updatePunishmentSyncStatus({
        env,
        rowIndex: sheetRowIndex,
        logMessageId,
        discordJumpUrl: jumpUrl,
        syncStatus: SyncStatus.POSTED,
        staffInfo: { name: staffName, id: staffDiscordId },
        punishmentId,
      });

      const confirmButtons = [];
      if (jumpUrl && isValidUrl(jumpUrl)) {
        confirmButtons.push({
          type: ComponentType.BUTTON,
          style: ButtonStyle.LINK,
          url: jumpUrl,
          label: "View Original Log",
          emoji: { name: "🔗" },
        });
      }
      confirmButtons.push({
        type: ComponentType.BUTTON,
        custom_id: `${PunishmentCustomId.BTN_LINKS_PREFIX}${punishmentId}`,
        label: "Links & Evidence",
        style: ButtonStyle.SECONDARY,
        emoji: { name: "📎" },
      });
      confirmButtons.push({
        type: ComponentType.BUTTON,
        custom_id: `${PunishmentCustomId.BTN_EDIT_PREFIX}${punishmentId}`,
        label: "Edit Record",
        style: ButtonStyle.SECONDARY,
        emoji: { name: "✏️" },
      });

      return new Response(
        JSON.stringify({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: EPHEMERAL_FLAG,
            content:
              `✅ **Punishment Logged Successfully**\n\n` +
              `Record **\`${punishmentId}\`** for **${playerName}** has been posted to <#${logChannelId}>.\n\n` +
              `[🔗 View Original Log](${jumpUrl})`,
            components: [
              {
                type: ComponentType.ACTION_ROW,
                components: confirmButtons,
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" } }
      );
    } else {
      // Discord post failed: mark Post Failed in sheet and notify staff
      await updatePunishmentSyncStatus({
        env,
        rowIndex: sheetRowIndex,
        logMessageId: "",
        discordJumpUrl: "",
        syncStatus: SyncStatus.POST_FAILED,
        staffInfo: { name: staffName, id: staffDiscordId },
        punishmentId,
      });

      return ephemeralTextResponse(
        `⚠️ **Punishment Saved to Database, but Discord Post Failed**\n\n` +
        `Punishment **\`${punishmentId}\`** was safely saved to the database, but could not be posted to <#${logChannelId}>.\n` +
        `**Error:** ${postErrorText || "Discord API error"}\n\n` +
        `The record has been marked as \`Post Failed\` in the database. Contact an administrator to retry syncing.`
      );
    }
  }

  // 3. Edit Punishment Record or Links/Evidence modal submission
  if (
    customId.startsWith(PunishmentCustomId.MODAL_EDIT_PREFIX) ||
    customId.startsWith(PunishmentCustomId.MODAL_LINKS_PREFIX)
  ) {
    const isLinksModal = customId.startsWith(PunishmentCustomId.MODAL_LINKS_PREFIX);
    const punishmentId = customId.slice(
      isLinksModal
        ? PunishmentCustomId.MODAL_LINKS_PREFIX.length
        : PunishmentCustomId.MODAL_EDIT_PREFIX.length
    );
    const values = getModalValues(interaction.data?.components || []);

    const playerName = values.player_name !== undefined ? values.player_name.trim() : undefined;
    const punishment = values.punishment !== undefined ? values.punishment.trim() : undefined;
    const punishmentLength = values.punishment_length !== undefined ? values.punishment_length.trim() : undefined;
    const reason = values.reason !== undefined ? values.reason.trim() : undefined;
    const additionalInfo = values.additional_info !== undefined ? values.additional_info.trim() : undefined;
    const reportUrl = values.report_url !== undefined ? values.report_url.trim() : undefined;
    const responseUrl = values.response_url !== undefined ? values.response_url.trim() : undefined;
    let evidenceImageUrl = values.evidence_image_url !== undefined ? values.evidence_image_url.trim() : undefined;

    if (interaction.data?.resolved?.attachments) {
      const resolvedAttachments = interaction.data.resolved.attachments;
      const fileIds = Array.isArray(values.evidence_image)
        ? values.evidence_image
        : Array.isArray(values.evidence_image_url)
        ? values.evidence_image_url
        : null;

      if (fileIds && fileIds.length > 0 && resolvedAttachments[fileIds[0]]) {
        const fileObj = resolvedAttachments[fileIds[0]];
        evidenceImageUrl = fileObj.url || fileObj.proxy_url || evidenceImageUrl;
      } else {
        const atts = Object.values(resolvedAttachments);
        if (atts.length > 0 && atts[0]) {
          evidenceImageUrl = atts[0].url || atts[0].proxy_url || evidenceImageUrl;
        }
      }
    }

    if (!isLinksModal) {
      if (playerName !== undefined && !playerName) {
        return ephemeralTextResponse("❌ Player / Character Name is required.");
      }
      if (punishment !== undefined && !punishment) {
        return ephemeralTextResponse("❌ Punishment is required.");
      }
      if (reason !== undefined && !reason) {
        return ephemeralTextResponse("❌ Reason is required.");
      }
    }

    const staffUser = interaction.member?.user || interaction.user;
    const staffInfo = {
      id: staffUser?.id || "0",
      name:
        interaction.member?.nick ||
        staffUser?.global_name ||
        staffUser?.username ||
        "Staff",
    };

    // Build updated fields map
    const updatedFields = {};
    if (playerName !== undefined) updatedFields.playerName = playerName;
    if (punishment !== undefined) updatedFields.punishment = punishment;
    if (punishmentLength !== undefined) updatedFields.punishmentLength = punishmentLength;
    if (reason !== undefined) updatedFields.reason = reason;
    if (additionalInfo !== undefined) updatedFields.additionalInfo = additionalInfo;
    if (reportUrl !== undefined) updatedFields.reportUrl = reportUrl;
    if (responseUrl !== undefined) updatedFields.responseUrl = responseUrl;
    if (evidenceImageUrl !== undefined) updatedFields.evidenceImageUrl = evidenceImageUrl;

    // --- Deferred response: ACK immediately, then do the heavy work ---
    const task = (async () => {
      try {
        // 1. Update Google Sheets row & append EDITED to Punishment Audits
        const { updatedRecord, changesSummary, auditSuccess } = await updatePunishmentRecord({
          env,
          punishmentId,
          updatedFields,
          staffInfo,
        });

        // 2. If nothing changed, inform staff and skip Discord PATCH
        if (changesSummary === "No fields changed") {
          await editOriginalInteractionResponse({
            interaction,
            env,
            content: `ℹ️ **No Changes Detected**\n\nNo fields were modified for **\`${punishmentId}\`**. The record remains unchanged.`,
          });
          return;
        }

        // 3. Edit original Discord message in #banwarnlog if logMessageId exists
        const channelId =
          updatedRecord.logChannelId ||
          env.PUNISHMENT_LOG_CHANNEL_ID ||
          DEFAULT_PUNISHMENT_LOG_CHANNEL_ID;
        const messageId = updatedRecord.logMessageId;

        if (messageId && channelId && env.DISCORD_BOT_TOKEN) {
          const newContent = formatPunishmentLog(updatedRecord);
          const newActionRows = createPunishmentActionRow(updatedRecord);
          const newEmbeds = formatPunishmentEmbeds(updatedRecord);

          const patchPayload = {
            content: newContent,
            components: newActionRows,
          };
          if (newEmbeds.length > 0) {
            patchPayload.embeds = newEmbeds;
          }

          const patchUrl = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
          const patchRes = await fetch(patchUrl, {
            method: "PATCH",
            headers: {
              Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(patchPayload),
          });

          if (!patchRes.ok) {
            const errText = await patchRes.text();
            if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
              console.warn(`Failed to PATCH Discord punishment message: ${errText}`);
            }
          }
        }

        // 4. Build success/partial-success confirmation
        const jumpPart = updatedRecord.discordJumpUrl
          ? `\n\n[🔗 View Original Log](${updatedRecord.discordJumpUrl})`
          : "";

        const changesList = changesSummary
          .split(", ")
          .map((c) => `• ${c}`)
          .join("\n");

        let confirmationContent;
        if (!auditSuccess) {
          confirmationContent =
            `⚠️ **Punishment Updated (Audit Warning)**\n\n` +
            `Record **\`${punishmentId}\`** for **${updatedRecord.playerName}** has been updated.\n\n` +
            `**Changes:**\n${changesList}\n\n` +
            `⚠️ _Punishment was updated successfully, but the audit log entry could not be written. ` +
            `Please notify a server administrator._${jumpPart}`;
        } else {
          confirmationContent =
            `✅ **Punishment Record Updated**\n\n` +
            `Record **\`${punishmentId}\`** for **${updatedRecord.playerName}** has been updated.\n\n` +
            `**Changes:**\n${changesList}${jumpPart}`;
        }

        await editOriginalInteractionResponse({
          interaction,
          env,
          content: confirmationContent,
        });
      } catch (err) {
        if (env?.ENVIRONMENT !== "test" && process.env?.NODE_ENV !== "test") {
          console.error(`[modal] edit failed for ${punishmentId}:`, err);
        }
        await editOriginalInteractionResponse({
          interaction,
          env,
          content: `❌ Failed to update punishment: ${err.message}`,
        }).catch(() => {});
      }
    })();

    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(task);
    }

    return deferredChannelMessageResponse(true);
  }

  return new Response("Unknown modal interaction", { status: 400 });
}
