import {
  ComponentType,
  ButtonStyle,
  PunishmentCustomId,
  VITAL_ORANGE,
  buildTranscriptReplaceCustomId,
  buildTranscriptCancelCustomId,
} from "./constants.js";
import { DAMO_BOT_VERSION, VITAL_RP_LOGO_URL } from "../../config.js";
import { formatPunishmentDate, isValidUrl } from "./formatter.js";
import { hashString } from "./transcript.js";

/**
 * Build the permanent Staff Punishment Center Container (Components V2).
 *
 * Structure:
 * Container (Type 17):
 *   Section (Type 9):
 *     components: [TextDisplay]:
 *       # ⚖️ Staff Punishment Center
 *       Log punishments and search player punishment history.
 *     accessory: Thumbnail (Type 11) using VITAL_RP_LOGO_URL
 *   ActionRow (Type 1):
 *     [ ➕ Log Punishment ] [ 🔎 Search History ] [ 🕘 Recent Logs ] [ 👤 My Logs ]
 *   Separator (Type 14)
 *   TextDisplay (Type 10):
 *     -# 🤖 Damo Bot • Punishment Manager
 *     -# v0.9.0-beta
 *
 * @returns {Object} Discord Components V2 Container
 */
export function buildPunishmentCenterContainer() {
  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.SECTION,
        components: [
          {
            type: ComponentType.TEXT_DISPLAY,
            content: "# ⚖️ Staff Punishment Center\nLog punishments and search punishment history.",
          },
        ],
        accessory: {
          type: ComponentType.THUMBNAIL,
          media: {
            url: VITAL_RP_LOGO_URL,
          },
          description: "Vital RP Logo",
        },
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            custom_id: PunishmentCustomId.BTN_LOG,
            label: "Log Punishment",
            style: ButtonStyle.PRIMARY,
            emoji: { name: "➕" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: PunishmentCustomId.BTN_SEARCH,
            label: "Search History",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "🔎" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: PunishmentCustomId.BTN_RECENT,
            label: "Recent Logs",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "🕘" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: PunishmentCustomId.BTN_MY_LOGS,
            label: "My Logs",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "👤" },
          },
        ],
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Punishment Manager\n-# ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Ephemeral prompt allowing staff to select a user from Discord or click Manual Entry.
 *
 * @returns {Object} Components V2 Container
 */
export function buildUserSelectPrompt() {
  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content: "### ⚖️ Log Player Punishment\nSelect the punished player below to automatically capture their Discord ID and display name, or use **Manual Entry** if they are not in the server.",
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.USER_SELECT,
            custom_id: PunishmentCustomId.USER_SELECT,
            placeholder: "Select punished Discord user...",
            min_values: 1,
            max_values: 1,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            custom_id: PunishmentCustomId.BTN_MANUAL,
            label: "Manual Entry",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "✏️" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: PunishmentCustomId.BTN_DISMISS,
            label: "Cancel",
            style: ButtonStyle.DANGER,
            emoji: { name: "❌" },
          },
        ],
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Punishment Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Build the modal for entering punishment details for a selected Discord user.
 * (5 inputs: Player Name, Punishment, Punishment Length, Reason, Additional Info)
 *
 * @param {Object} options
 * @param {string} options.userId
 * @param {string} options.displayName
 * @returns {Object} Discord Modal payload
 */
export function buildPunishmentModal({ userId, displayName }) {
  return {
    title: "Log Punishment",
    custom_id: `${PunishmentCustomId.MODAL_SUBMIT_PREFIX}${userId}`,
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "player_name",
            label: "Player / Character Name",
            style: 1, // Short
            required: true,
            placeholder: "e.g. Yamsheed Yaffari",
            value: displayName || "",
            max_length: 100,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "punishment",
            label: "Punishment",
            style: 1, // Short
            required: true,
            placeholder: "e.g. Warning, 2 Day Ban, Permanent Ban",
            max_length: 100,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "punishment_length",
            label: "Punishment Length (Optional)",
            style: 1, // Short
            required: false,
            placeholder: "e.g. 1 Day, 2 Days, 7 Days, Permanent",
            max_length: 50,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "reason",
            label: "Reason",
            style: 2, // Paragraph
            required: true,
            placeholder: "Detailed explanation of rule violation...",
            max_length: 1500,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "additional_info",
            label: "Additional Information (Optional)",
            style: 2, // Paragraph
            required: false,
            placeholder: "Additional context, prior warnings, scene notes...",
            max_length: 1000,
          },
        ],
      },
    ],
  };
}

/**
 * Build the manual entry modal when a Discord user is unavailable or left server.
 * (5 inputs: Player Name, Player Discord ID, Punishment, Punishment Length, Reason)
 *
 * @returns {Object} Discord Modal payload
 */
export function buildManualPunishmentModal() {
  return {
    title: "Log Punishment (Manual Entry)",
    custom_id: `${PunishmentCustomId.MODAL_SUBMIT_PREFIX}manual`,
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "player_name",
            label: "Player / Character Name",
            style: 1, // Short
            required: true,
            placeholder: "e.g. Yamsheed Yaffari",
            max_length: 100,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "player_discord_id",
            label: "Player Discord ID (Optional)",
            style: 1, // Short
            required: false,
            placeholder: "18-19 digit Discord ID if known",
            max_length: 30,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "punishment",
            label: "Punishment",
            style: 1, // Short
            required: true,
            placeholder: "e.g. Warning, 2 Day Ban, Permanent Ban",
            max_length: 100,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "punishment_length",
            label: "Punishment Length (Optional)",
            style: 1, // Short
            required: false,
            placeholder: "e.g. 1 Day, 2 Days, 7 Days, Permanent",
            max_length: 50,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "reason",
            label: "Reason",
            style: 2, // Paragraph
            required: true,
            placeholder: "Detailed explanation of rule violation and context...",
            max_length: 1500,
          },
        ],
      },
    ],
  };
}

/**
 * Build the modal for initiating a punishment search query.
 *
 * @returns {Object} Discord Modal payload
 */
export function buildSearchModal() {
  return {
    title: "Search Punishment History",
    custom_id: PunishmentCustomId.MODAL_SEARCH,
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "search_query",
            label: "Search Query",
            style: 1, // Short
            required: true,
            placeholder: "Punishment ID, Discord ID, Player Name, or Staff",
            max_length: 100,
          },
        ],
      },
    ],
  };
}

/**
 * Build a polished Components V2 container displaying punishment history / search results.
 *
 * @param {Object} options
 * @param {string} options.title e.g. "🔎 PUNISHMENT HISTORY"
 * @param {string} [options.subtitle] e.g. "Yamsheed Yaffari • 4 records found"
 * @param {Array<Object>} options.records
 * @param {number} [options.page=1]
 * @param {number} [options.pageSize=3]
 * @param {string} [options.queryKey=""]
 * @returns {Object} Components V2 Container
 */
export function buildSearchResultsContainer({
  title = "🔎 PUNISHMENT HISTORY",
  subtitle = "",
  records = [],
  page = 1,
  pageSize = 3,
  queryKey = "",
}) {
  const totalCount = records.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRecords = records.slice(startIndex, startIndex + pageSize);

  const innerComponents = [];

  // Header Section
  let headerContent = `### ${title}`;
  if (subtitle) {
    headerContent += `\n${subtitle}`;
  }
  headerContent += `\n*Showing ${pageRecords.length} of ${totalCount} record(s) • Page ${currentPage} of ${totalPages}*`;

  innerComponents.push({
    type: ComponentType.TEXT_DISPLAY,
    content: headerContent,
  });

  if (pageRecords.length === 0) {
    innerComponents.push({
      type: ComponentType.SEPARATOR,
      divider: true,
      spacing: 1,
    });
    innerComponents.push({
      type: ComponentType.TEXT_DISPLAY,
      content: "No matching punishment records found.",
    });
  } else {
    for (const rec of pageRecords) {
      innerComponents.push({
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      });

      const dateDisplay = formatPunishmentDate(rec.createdAt);
      const lengthPrefix = rec.punishmentLength ? `${rec.punishmentLength} • ` : "";
      const cardLines = [
        `**${rec.punishmentId || "VRP-P-000000"}** • **${rec.punishment || "Punishment"}**`,
        `${lengthPrefix}${dateDisplay}`,
        "",
        `> ${rec.reason ? rec.reason.replace(/\n+/g, " ") : "No reason recorded"}`,
        "",
        `-# Logged by ${rec.staffName || "Staff"}`,
      ];

      const hints = [];
      if (rec.additionalInfo && rec.additionalInfo.trim()) hints.push("Has additional info");
      if (rec.evidenceImageUrl && rec.evidenceImageUrl.trim()) hints.push("Has evidence");
      if (hints.length > 0) {
        cardLines.push(`-# ${hints.join(" • ")}`);
      }

      innerComponents.push({
        type: ComponentType.TEXT_DISPLAY,
        content: cardLines.join("\n"),
      });

      // Card action row: View Original Log + Edit Record + Links & Evidence + Player History
      const cardButtons = [];

      if (rec.discordJumpUrl && isValidUrl(rec.discordJumpUrl)) {
        cardButtons.push({
          type: ComponentType.BUTTON,
          style: ButtonStyle.LINK,
          url: rec.discordJumpUrl,
          label: "View Original Log",
          emoji: { name: "🔗" },
        });
      }

      if (rec.punishmentId) {
        cardButtons.push({
          type: ComponentType.BUTTON,
          custom_id: `${PunishmentCustomId.BTN_EDIT_PREFIX}${rec.punishmentId}`,
          label: "Edit Record",
          style: ButtonStyle.SECONDARY,
          emoji: { name: "✏️" },
        });

        cardButtons.push({
          type: ComponentType.BUTTON,
          custom_id: `${PunishmentCustomId.BTN_LINKS_PREFIX}${rec.punishmentId}`,
          label: "Links & Evidence",
          style: ButtonStyle.SECONDARY,
          emoji: { name: "📎" },
        });
      }

      const lookupId = (rec.playerDiscordId && rec.playerDiscordId !== "N/A")
        ? rec.playerDiscordId
        : rec.playerName;

      if (lookupId) {
        cardButtons.push({
          type: ComponentType.BUTTON,
          custom_id: `${PunishmentCustomId.BTN_PLAYER_HISTORY_PREFIX}${lookupId}`,
          label: "Player History",
          style: ButtonStyle.SECONDARY,
          emoji: { name: "👤" },
        });
      }

      if (cardButtons.length > 0) {
        innerComponents.push({
          type: ComponentType.ACTION_ROW,
          components: cardButtons,
        });
      }
    }
  }

  // Pagination row if multiple pages
  if (totalPages > 1) {
    innerComponents.push({
      type: ComponentType.SEPARATOR,
      divider: true,
      spacing: 1,
    });

    const encodedQuery = encodeURIComponent(queryKey || "");
    innerComponents.push({
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          custom_id: `${PunishmentCustomId.BTN_PAGE_PREFIX}${currentPage - 1}:${encodedQuery}`,
          label: "Previous",
          style: ButtonStyle.SECONDARY,
          emoji: { name: "⬅️" },
          disabled: currentPage <= 1,
        },
        {
          type: ComponentType.BUTTON,
          custom_id: `${PunishmentCustomId.BTN_PAGE_PREFIX}${currentPage + 1}:${encodedQuery}`,
          label: "Next",
          style: ButtonStyle.SECONDARY,
          emoji: { name: "➡️" },
          disabled: currentPage >= totalPages,
        },
      ],
    });
  }

  // Footer
  innerComponents.push({
    type: ComponentType.SEPARATOR,
    divider: true,
    spacing: 1,
  });
  innerComponents.push({
    type: ComponentType.TEXT_DISPLAY,
    content: `-# 🤖 Damo Bot • Punishment Manager • ${DAMO_BOT_VERSION}`,
  });

  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: innerComponents,
  };
}

/**
 * Build the modal for editing an existing punishment record.
 * Pre-populates existing values from the Google Sheet record.
 *
 * @param {Object} record
 * @returns {Object} Discord Modal payload
 */
export function buildEditPunishmentModal(record) {
  return {
    title: `Edit Record (${record.punishmentId})`,
    custom_id: `${PunishmentCustomId.MODAL_EDIT_PREFIX}${record.punishmentId}`,
    components: [
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "player_name",
            label: "Player / Character Name",
            style: 1, // Short
            required: true,
            value: record.playerName || "",
            max_length: 100,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "punishment",
            label: "Punishment",
            style: 1, // Short
            required: true,
            value: record.punishment || "",
            placeholder: "e.g. Warning, 2 Day Ban, Permanent Ban",
            max_length: 100,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "punishment_length",
            label: "Punishment Length (Optional)",
            style: 1, // Short
            required: false,
            value: record.punishmentLength || "",
            placeholder: "e.g. 1 Day, 2 Days, 7 Days, Permanent",
            max_length: 50,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "reason",
            label: "Reason",
            style: 2, // Paragraph
            required: true,
            value: record.reason || "",
            placeholder: "Detailed explanation of rule violation and context...",
            max_length: 1500,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "additional_info",
            label: "Additional Information (Optional)",
            style: 2, // Paragraph
            required: false,
            value: record.additionalInfo || "",
            placeholder: "Additional context, prior warnings, scene notes...",
            max_length: 1000,
          },
        ],
      },
    ],
  };
}

/**
 * Build the modal for adding or updating URLs and Evidence Images on a record.
 *
 * @param {Object} record
 * @returns {Object} Discord Modal payload
 */
export function buildEditLinksModal(record) {
  return {
    title: `Links & Evidence (${record.punishmentId})`,
    custom_id: `${PunishmentCustomId.MODAL_LINKS_PREFIX}${record.punishmentId}`,
    components: [
      {
        type: ComponentType.LABEL,
        label: "Report / Ticket Reference (Optional)",
        description: "Discord message/channel URL or ticket reference",
        component: {
          type: ComponentType.TEXT_INPUT,
          custom_id: "report_url",
          style: 1, // Short
          required: false,
          value: record.reportUrl || "",
          placeholder: "Discord message/channel URL or ticket reference",
          max_length: 300,
        },
      },
      {
        type: ComponentType.LABEL,
        label: "Player Response URL (Optional)",
        description: "Discord message or channel URL for player response",
        component: {
          type: ComponentType.TEXT_INPUT,
          custom_id: "response_url",
          style: 1, // Short
          required: false,
          value: record.responseUrl || "",
          placeholder: "Discord message or channel URL for player response",
          max_length: 300,
        },
      },
      {
        type: ComponentType.LABEL,
        label: "Evidence Screenshot / Photo (Optional)",
        description: "Upload a screenshot or photo for evidence",
        component: {
          type: ComponentType.FILE_UPLOAD,
          custom_id: "evidence_image",
          min_values: 0,
          max_values: 1,
          required: false,
        },
      },
      {
        type: ComponentType.LABEL,
        label: "Additional Information (Optional)",
        description: "Additional context, prior warnings, scene notes",
        component: {
          type: ComponentType.TEXT_INPUT,
          custom_id: "additional_info",
          style: 2, // Paragraph
          required: false,
          value: record.additionalInfo || "",
          placeholder: "Additional context or notes...",
          max_length: 1000,
        },
      },
    ],
  };
}

/**
 * Format a simple date (e.g. "Sep 3, 2026") for select menu descriptions.
 */
function formatOptionDate(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "Unknown Date";
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return "Unknown Date";
  }
}

/**
 * Ephemeral prompt asking staff which player the selected TicketTool transcript belongs to.
 *
 * @param {Object} options
 * @param {string} options.channelId
 * @param {string} options.messageId
 * @returns {Object} Components V2 Container
 */
export function buildAddTicketTranscriptPrompt({ channelId, messageId }) {
  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content:
          `⚖️ **Add Ticket Transcript**\n\n` +
          `Which player does this transcript belong to?`,
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.USER_SELECT,
            custom_id: `${PunishmentCustomId.USER_SELECT_TRANSCRIPT_PREFIX}${channelId}:${messageId}`,
            placeholder: "Select Player...",
            min_values: 1,
            max_values: 1,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            custom_id: PunishmentCustomId.BTN_DISMISS,
            label: "Cancel",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "❌" },
          },
        ],
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Punishment Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Build the ephemeral panel displayed after selecting a player with Add to Punishment.
 * Displays up to 5 latest records with a select menu.
 *
 * @param {Object} options
 * @param {Object} options.player { id, name }
 * @param {Array<Object>} options.records
 * @param {number} options.totalCount
 * @param {string} options.channelId
 * @param {string} options.messageId
 * @returns {Object} Components V2 Container
 */
export function buildAddToPunishmentSelectorContainer({
  player,
  records,
  totalCount,
  channelId,
  messageId,
}) {
  const cards = records
    .map((rec) => {
      const pType =
        rec.punishmentLength && !rec.punishment.includes(rec.punishmentLength)
          ? `${rec.punishmentLength} ${rec.punishment}`
          : rec.punishment;
      const dateStr = formatOptionDate(rec.createdAt);
      const reasonStr = rec.reason ? ` • ${rec.reason}` : "";
      return `**${rec.punishmentId}** • ${pType}\n${dateStr}${reasonStr}`;
    })
    .join("\n\n");

  const selectOptions = records.map((rec) => {
    const pType =
      rec.punishmentLength && !rec.punishment.includes(rec.punishmentLength)
        ? `${rec.punishmentLength} ${rec.punishment}`
        : rec.punishment;
    const rawLabel = `${rec.punishmentId} • ${pType}`;
    const label =
      rawLabel.length > 100 ? rawLabel.slice(0, 97) + "..." : rawLabel;

    const dateStr = formatOptionDate(rec.createdAt);
    const cleanReason = (rec.reason || "No reason")
      .replace(/\r?\n/g, " ")
      .trim();
    const rawDesc = `${dateStr} • ${cleanReason}`;
    const description =
      rawDesc.length > 100 ? rawDesc.slice(0, 97) + "..." : rawDesc;

    return {
      label,
      value: rec.punishmentId,
      description,
      emoji: { name: "⚖️" },
    };
  });

  const actionButtons = [];
  if (totalCount > 5) {
    actionButtons.push({
      type: ComponentType.BUTTON,
      custom_id: `${PunishmentCustomId.BTN_PLAYER_HISTORY_PREFIX}${player.id}`,
      label: "Search Older Records",
      style: ButtonStyle.SECONDARY,
      emoji: { name: "🔎" },
    });
  }
  actionButtons.push({
    type: ComponentType.BUTTON,
    custom_id: PunishmentCustomId.BTN_DISMISS,
    label: "Cancel",
    style: ButtonStyle.DANGER,
    emoji: { name: "❌" },
  });

  const subtext =
    totalCount > 5
      ? `-# Showing latest 5 punishments • ${totalCount} total on file`
      : `-# Showing latest ${records.length} punishments`;

  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content:
          `⚖️ **Punishments for ${player.name}**\n\n` +
          `Select the punishment this transcript belongs to.\n\n` +
          `${cards}`,
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.STRING_SELECT,
            custom_id: `${PunishmentCustomId.SELECT_ADD_TRANSCRIPT_PREFIX}${player.id}:${channelId}:${messageId}`,
            placeholder: "Select punishment record...",
            options: selectOptions,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: actionButtons,
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `${subtext}\n-# 🤖 Damo Bot • Punishment Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Build the ephemeral confirmation panel asking staff which transcript type to attach:
 * Report Transcript or Response Transcript.
 *
 * @param {Object} options
 * @param {string} options.punishmentId
 * @param {string} options.playerName
 * @param {string} options.punishment
 * @param {string} [options.punishmentLength]
 * @param {string} options.channelId
 * @param {string} options.messageId
 * @returns {Object} Components V2 Container
 */
export function buildTranscriptTypeChoiceContainer({
  punishmentId,
  playerName,
  punishment,
  punishmentLength,
  channelId,
  messageId,
}) {
  const pType =
    punishmentLength && !punishment.includes(punishmentLength)
      ? `${punishmentLength} ${punishment}`
      : punishment;

  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content:
          `⚖️ **${punishmentId}**\n` +
          `**Player:** ${playerName}\n` +
          `**Punishment:** ${pType}\n\n` +
          `Which transcript are you attaching?`,
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}report:${punishmentId}:${channelId}:${messageId}`,
            label: "Report Transcript",
            style: ButtonStyle.PRIMARY,
            emoji: { name: "📋" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: `${PunishmentCustomId.BTN_CHOOSE_TRANSCRIPT_PREFIX}response:${punishmentId}:${channelId}:${messageId}`,
            label: "Response Transcript",
            style: ButtonStyle.PRIMARY,
            emoji: { name: "💬" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: PunishmentCustomId.BTN_DISMISS,
            label: "Cancel",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "❌" },
          },
        ],
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Punishment Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Build the overwrite warning panel if a Report or Response URL is already present.
 *
 * @param {Object} options
 * @param {string} options.punishmentId
 * @param {string} options.transcriptType "report" or "response"
 * @param {string} options.existingUrl
 * @param {string} options.channelId
 * @param {string} options.messageId
 * @returns {Object} Components V2 Container
 */
export function buildTranscriptOverwriteWarningContainer({
  punishmentId,
  transcriptType,
  existingUrl,
  channelId,
  messageId,
  token,
}) {
  const typeLabel = transcriptType === "report" ? "Report" : "Response";
  const expectedHash = hashString(existingUrl || "");

  const replaceCustomId = token
    ? buildTranscriptReplaceCustomId(token)
    : `${PunishmentCustomId.LEGACY_CONFIRM_REPLACE_PREFIX}${transcriptType}:${punishmentId}:${channelId}:${messageId}:${expectedHash}`;

  const cancelCustomId = token
    ? buildTranscriptCancelCustomId(token)
    : PunishmentCustomId.BTN_CANCEL_REPLACE;

  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content:
          `⚠️ **${typeLabel} Transcript Already Exists**\n\n` +
          `\`${punishmentId}\` already has a ${typeLabel} Transcript.\n\n` +
          `**Existing:** ${existingUrl}\n\n` +
          `Attaching this transcript will replace the existing ${typeLabel} link. Are you sure?`,
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            custom_id: replaceCustomId,
            label: "Replace Existing",
            style: ButtonStyle.DANGER,
            emoji: { name: "⚠️" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: cancelCustomId,
            label: "Cancel",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "❌" },
          },
        ],
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Punishment Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Build the ephemeral panel displayed when the selected player has no punishment history.
 *
 * @param {Object} options
 * @param {string} [options.playerId]
 * @param {string} [options.playerName]
 * @param {string} [options.authorId]
 * @param {string} [options.authorName]
 * @param {string} options.channelId
 * @param {string} options.messageId
 * @returns {Object} Components V2 Container
 */
export function buildNoPunishmentRecordsContainer({
  playerId,
  playerName,
  authorId,
  authorName,
  channelId,
  messageId,
}) {
  const targetId = playerId || authorId || "";
  const targetName = playerName || authorName || "Unknown Player";

  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content:
          `⚖️ **Add Ticket Transcript**\n\n` +
          `No punishment records were found for this player (**${targetName}** • \`${targetId}\`).\n\n` +
          `You can create a new punishment record with this transcript attached.`,
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            custom_id: `${PunishmentCustomId.BTN_CREATE_WITH_MSG_PREFIX}${targetId}:${channelId}:${messageId}`,
            label: "Create New Punishment",
            style: ButtonStyle.PRIMARY,
            emoji: { name: "➕" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: PunishmentCustomId.BTN_DISMISS,
            label: "Cancel",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "❌" },
          },
        ],
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Punishment Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}
