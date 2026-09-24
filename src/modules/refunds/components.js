import {
  ComponentType,
  ButtonStyle,
  RefundCustomId,
  REFUND_CATEGORY_OPTIONS,
  VITAL_ORANGE,
  buildRefundPlayerHistoryCustomId,
  buildRefundHistoryPageCustomId,
  refundConfig,
  getRefundCategoryConfig,
  getActiveRefundCategoryOptions,
} from "./constants.js";
import { DAMO_BOT_VERSION, VITAL_RP_LOGO_URL } from "../../config.js";
import { formatRefundDate, isValidUrl, normalizeUrl } from "./formatter.js";

/**
 * Build the permanent Staff Refund Center Container (Components V2).
 *
 * Structure:
 * Container (Type 17):
 *   Section (Type 9):
 *     components: [TextDisplay]:
 *       # 💰 Staff Refund Center
 *       Log refunds and search player refund history.
 *     accessory: Thumbnail (Type 11) using VITAL_RP_LOGO_URL
 *   ActionRow (Type 1):
 *     [ ➕ Log Refund ] [ 🔎 Search History ] [ 🕘 Recent Refunds ] [ 👤 My Refunds ]
 *   Separator (Type 14)
 *   TextDisplay (Type 10):
 *     -# 🤖 Damo Bot • Refund Manager
 *     -# vX.Y.Z-beta
 *
 * @returns {Object} Discord Components V2 Container
 */
export function buildRefundCenterContainer() {
  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.SECTION,
        components: [
          {
            type: ComponentType.TEXT_DISPLAY,
            content: "# 💰 Staff Refund Center\nLog refunds and search player refund history.",
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
            custom_id: RefundCustomId.BTN_LOG,
            label: "Log Refund",
            style: ButtonStyle.PRIMARY,
            emoji: { name: "➕" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: RefundCustomId.BTN_SEARCH,
            label: "Search History",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "🔎" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: RefundCustomId.BTN_RECENT,
            label: "Recent Refunds",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "🕘" },
          },
          {
            type: ComponentType.BUTTON,
            custom_id: RefundCustomId.BTN_MY_LOGS,
            label: "My Refunds",
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
        content: `-# 🤖 Damo Bot • Refund Manager\n-# ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Ephemeral prompt allowing staff to select a user from Discord or click Manual Entry.
 *
 * @returns {Object} Components V2 Container
 */
export function buildRefundUserSelectPrompt() {
  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content: "### 💰 Log Player Refund\nSelect the player receiving the refund below to automatically capture their Discord ID and display name, or use **Manual Entry** if they are not in the server.",
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.USER_SELECT,
            custom_id: RefundCustomId.USER_SELECT,
            placeholder: "Select player receiving refund...",
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
            custom_id: RefundCustomId.BTN_MANUAL,
            label: "Manual Entry",
            style: ButtonStyle.SECONDARY,
            emoji: { name: "✏️" },
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
        content: `-# 🤖 Damo Bot • Refund Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Build the modal for entering refund details for a selected Discord user.
 * (5 inputs: Player Name, Refund Category, Refund Details, Reason, Ticket URL)
 *
 * @param {Object} options
 * @param {string} options.userId
 * @param {string} options.displayName
 * @returns {Object} Discord Modal payload
 */
export function buildRefundModal({ userId, displayName }) {
  return {
    title: "Log Refund",
    custom_id: `${RefundCustomId.MODAL_SUBMIT_PREFIX}${userId}`,
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
            placeholder: "e.g. John Doe",
            value: displayName || "",
            max_length: 100,
          },
        ],
      },
      {
        type: ComponentType.LABEL,
        label: "Refund Category",
        component: {
          type: ComponentType.STRING_SELECT,
          custom_id: "refund_category",
          placeholder: `Select category (${refundConfig.categories.filter((c) => c.enabled !== false).map((c) => c.label).slice(0, 4).join(", ")})...`,
          options: getActiveRefundCategoryOptions(),
          min_values: 1,
          max_values: 1,
        },
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "refund_details",
            label: "Refund Details",
            style: 1, // Short
            required: true,
            placeholder: "e.g. 50,000 Vitcoins, $25,000 Cash, 500 S-Coins",
            max_length: 150,
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
            placeholder: "Detailed explanation of refund justification...",
            max_length: 1500,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "ticket_url",
            label: "Ticket URL (Optional)",
            style: 1, // Short
            required: false,
            placeholder: "https://... (Discord message link, ticket transcript, or any URL)",
            max_length: 500,
          },
        ],
      },
    ],
  };
}

/**
 * Build the manual entry modal when a Discord user is unavailable or left server.
 * (5 inputs: Player Name, Player Discord ID, Refund Category, Refund Details, Reason)
 *
 * @returns {Object} Discord Modal payload
 */
export function buildManualRefundModal() {
  return {
    title: "Log Refund (Manual Entry)",
    custom_id: `${RefundCustomId.MODAL_SUBMIT_PREFIX}manual`,
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
            placeholder: "e.g. John Doe",
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
        type: ComponentType.LABEL,
        label: "Refund Category",
        component: {
          type: ComponentType.STRING_SELECT,
          custom_id: "refund_category",
          placeholder: `Select category (${refundConfig.categories.filter((c) => c.enabled !== false).map((c) => c.label).slice(0, 4).join(", ")})...`,
          options: getActiveRefundCategoryOptions(),
          min_values: 1,
          max_values: 1,
        },
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "refund_details",
            label: "Refund Details",
            style: 1, // Short
            required: true,
            placeholder: "e.g. 50,000 Vitcoins, $25,000 Cash, 500 S-Coins",
            max_length: 150,
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
            placeholder: "Detailed explanation of refund justification...",
            max_length: 1500,
          },
        ],
      },
    ],
  };
}

/**
 * Build the modal for initiating a refund search query.
 *
 * @returns {Object} Discord Modal payload
 */
export function buildSearchRefundModal() {
  return {
    title: "Search Refund History",
    custom_id: RefundCustomId.MODAL_SEARCH,
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
            placeholder: "Refund ID, Discord ID, Player Name, Staff, or Details",
            max_length: 100,
          },
        ],
      },
    ],
  };
}

/**
 * Build the modal for editing an existing refund record.
 * Pre-populates existing values from the record.
 *
 * @param {Object} record
 * @returns {Object} Discord Modal payload
 */
export function buildEditRefundModal(record) {
  const currentCategory = (record.refundCategory || "Other").toLowerCase();
  const rawOptions = getActiveRefundCategoryOptions();
  const categoryOptions = rawOptions.map((opt) => ({
    ...opt,
    default: opt.value.toLowerCase() === currentCategory,
  }));

  return {
    title: `Edit Refund (${record.refundId || "Record"})`,
    custom_id: `${RefundCustomId.MODAL_EDIT_PREFIX}${record.refundId}`,
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
        type: ComponentType.LABEL,
        label: "Refund Category",
        component: {
          type: ComponentType.STRING_SELECT,
          custom_id: "refund_category",
          placeholder: "Select category...",
          options: categoryOptions,
          min_values: 1,
          max_values: 1,
        },
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "refund_details",
            label: "Refund Details",
            style: 1, // Short
            required: true,
            value: record.refundDetails || "",
            placeholder: "e.g. 50,000 Vitcoins, $25,000 Cash, 500 S-Coins",
            max_length: 150,
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
            placeholder: "Detailed explanation of refund justification...",
            max_length: 1500,
          },
        ],
      },
      {
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.TEXT_INPUT,
            custom_id: "ticket_url",
            label: "Ticket URL (Optional)",
            style: 1, // Short
            required: false,
            value: record.ticketUrl || "",
            placeholder: "https://... (Discord message link, ticket transcript, or any URL)",
            max_length: 500,
          },
        ],
      },
    ],
  };
}

/**
 * Build a polished Components V2 container displaying refund history / search results.
 *
 * @param {Object} options
 * @param {string} options.title e.g. "🔎 REFUND HISTORY"
 * @param {string} [options.subtitle] e.g. "John Doe • 3 records found"
 * @param {Array<Object>} options.records
 * @param {number} [options.page=1]
 * @param {number} [options.pageSize=5]
 * @param {string} [options.queryKey=""]
 * @param {string} [options.categoryFilter="All"]
 * @returns {Object} Components V2 Container
 */
export function buildRefundSearchResultsContainer({
  title = "🔎 REFUND SEARCH RESULTS",
  subtitle = "",
  records = [],
  page = 1,
  pageSize = 3,
  queryKey = "",
  categoryFilter = "All",
}) {
  const totalCount = records.length;
  const effectivePageSize = Math.max(1, parseInt(pageSize, 10) || 3);
  const totalPages = Math.max(1, Math.ceil(totalCount / effectivePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * effectivePageSize;
  const pageRecords = records.slice(startIndex, startIndex + effectivePageSize);

  const innerComponents = [];

  // Header Section
  let headerContent = `### ${title}`;
  if (subtitle) {
    headerContent += `\n${subtitle}`;
  }
  const filterLabel = categoryFilter && categoryFilter.toLowerCase() !== "all" ? ` • Filter: **${categoryFilter}**` : "";
  headerContent += `\n*Showing ${pageRecords.length} of ${totalCount} record(s) • Page ${currentPage} of ${totalPages}${filterLabel}*`;

  innerComponents.push({
    type: ComponentType.TEXT_DISPLAY,
    content: headerContent,
  });

  // Category Filter ActionRow (dynamically populated from refundConfig.categories)
  const activeCategories = refundConfig.categories.filter(
    (cat) => cat.enabled !== false
  );
  const filterOptions = [
    { id: "All", label: "All", emoji: "📁" },
    ...activeCategories,
  ];

  const filterButtons = filterOptions.map((cat) => {
    const isSelected =
      (categoryFilter || "All").toLowerCase() === cat.id.toLowerCase() ||
      (categoryFilter || "All").toLowerCase() === (cat.label || "").toLowerCase();

    return {
      type: ComponentType.BUTTON,
      custom_id: `${RefundCustomId.BTN_FILTER_PREFIX}${cat.id}:${encodeURIComponent(queryKey || "")}:1`,
      label: cat.label || cat.id,
      style: isSelected ? ButtonStyle.PRIMARY : ButtonStyle.SECONDARY,
      emoji: { name: cat.emoji || "📁" },
    };
  });

  // Chunk buttons into rows of up to 5 buttons (Discord Action Row limit)
  for (let i = 0; i < filterButtons.length; i += 5) {
    innerComponents.push({
      type: ComponentType.ACTION_ROW,
      components: filterButtons.slice(i, i + 5),
    });
  }

  if (pageRecords.length === 0) {
    innerComponents.push({
      type: ComponentType.SEPARATOR,
      divider: true,
      spacing: 1,
    });
    innerComponents.push({
      type: ComponentType.TEXT_DISPLAY,
      content: "No matching refund records found.",
    });
  } else {
    for (const rec of pageRecords) {
      innerComponents.push({
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      });

      const dateDisplay = formatRefundDate(rec.createdAt);
      const catConfig = getRefundCategoryConfig(rec.refundCategory);
      const catLabel = catConfig.label || rec.refundCategory || "Other";
      const cardLines = [
        `**${rec.refundId || "VRP-R-000000"}** • **[${catLabel}]** • **${rec.refundDetails || "Refund"}**`,
        `Player: **${rec.playerName || "Unknown"}** • ${dateDisplay}`,
        "",
        `> ${rec.reason ? rec.reason.replace(/\n+/g, " ") : "No reason recorded"}`,
        "",
        `-# Logged by ${rec.staffName || "Staff"}`,
      ];

      innerComponents.push({
        type: ComponentType.TEXT_DISPLAY,
        content: cardLines.join("\n"),
      });

      // Card action row: View Original Log + Ticket link + Player History
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

      const ticketUrl = normalizeUrl(rec.ticketUrl);
      if (ticketUrl && isValidUrl(ticketUrl)) {
        cardButtons.push({
          type: ComponentType.BUTTON,
          style: ButtonStyle.LINK,
          url: ticketUrl,
          label: "Ticket",
          emoji: { name: "🎫" },
        });
      }

      if (rec.refundId) {
        cardButtons.push({
          type: ComponentType.BUTTON,
          custom_id: `${RefundCustomId.BTN_EDIT_PREFIX}${rec.refundId}`,
          label: "Edit Record",
          style: ButtonStyle.SECONDARY,
          emoji: { name: "✏️" },
        });
      }

      cardButtons.push({
        type: ComponentType.BUTTON,
        custom_id: buildRefundPlayerHistoryCustomId(rec.refundId),
        label: "Player History",
        style: ButtonStyle.SECONDARY,
        emoji: { name: "👤" },
      });

      innerComponents.push({
        type: ComponentType.ACTION_ROW,
        components: cardButtons,
      });
    }
  }

  // Pagination Action Row (if more than 1 page)
  if (totalPages > 1) {
    innerComponents.push({
      type: ComponentType.SEPARATOR,
      divider: true,
      spacing: 1,
    });

    const pageButtons = [
      {
        type: ComponentType.BUTTON,
        custom_id: `${RefundCustomId.BTN_PAGE_PREFIX}prev:${encodeURIComponent(queryKey || "")}:${categoryFilter}:${currentPage - 1}`,
        label: "Previous",
        style: ButtonStyle.SECONDARY,
        emoji: { name: "◀" },
        disabled: currentPage <= 1,
      },
      {
        type: ComponentType.BUTTON,
        custom_id: `${RefundCustomId.BTN_PAGE_PREFIX}next:${encodeURIComponent(queryKey || "")}:${categoryFilter}:${currentPage + 1}`,
        label: "Next",
        style: ButtonStyle.SECONDARY,
        emoji: { name: "▶" },
        disabled: currentPage >= totalPages,
      },
    ];

    innerComponents.push({
      type: ComponentType.ACTION_ROW,
      components: pageButtons,
    });
  }

  // Footer separator & text
  innerComponents.push({
    type: ComponentType.SEPARATOR,
    divider: true,
    spacing: 1,
  });

  innerComponents.push({
    type: ComponentType.TEXT_DISPLAY,
    content: `-# 🤖 Damo Bot • Refund Manager • ${DAMO_BOT_VERSION}`,
  });

  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: innerComponents,
  };
}

/**
 * Format date to short string: "Sep 4, 2026".
 * @param {string|Date} dateInput
 * @returns {string}
 */
export function formatShortDate(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "Unknown Date";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return "Unknown Date";
  }
}

/**
 * Build the compact Components V2 container for Player Refund History.
 *
 * Header:
 * 💸 **Refund History**
 * **PlayerName**
 * `playerDiscordId`
 * **X refund records**
 *
 * Real Separator
 *
 * For each record:
 * **REF-000021** • **Category**
 * Date
 * > Details / Amount
 * > Reason (optional)
 * -# Logged by StaffName
 * [ 🔗 View Refund ] (Link button if jump URL exists)
 *
 * Pagination:
 * Showing 1-5 of 12
 * [ ← Previous ] [ Next → ]
 *
 * @param {Object} options
 * @param {string} options.playerDiscordId
 * @param {string} options.playerName
 * @param {Array<Object>} options.records
 * @param {number} [options.page=1]
 * @param {number} [options.pageSize=5]
 * @returns {Object} Discord Components V2 Container
 */
export function buildPlayerRefundHistoryContainer({
  playerDiscordId,
  playerName,
  records = [],
  page = 1,
  pageSize = 5,
}) {
  const totalCount = records.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRecords = records.slice(startIndex, startIndex + pageSize);

  const innerComponents = [];

  // Header
  const headerContent = [
    "💸 **Refund History**",
    "",
    `**${playerName || "Player"}**`,
    `\`${playerDiscordId}\``,
    "",
    `**${totalCount} refund record${totalCount === 1 ? "" : "s"}**`,
  ].join("\n");

  innerComponents.push({
    type: ComponentType.TEXT_DISPLAY,
    content: headerContent,
  });

  // Record cards separated by real Separators
  for (const rec of pageRecords) {
    innerComponents.push({
      type: ComponentType.SEPARATOR,
      divider: true,
      spacing: 1,
    });

    const dateStr = formatShortDate(rec.createdAt);
    const detailsLine = rec.refundDetails
      ? `> ${rec.refundDetails.replace(/\r?\n/g, " ")}`
      : "> Refund";
    const reasonLine = rec.reason
      ? `\n> *Reason:* ${rec.reason.replace(/\r?\n/g, " ")}`
      : "";

    const catConfig = getRefundCategoryConfig(rec.refundCategory);
    const catLabel = catConfig.label || rec.refundCategory || "Other";
    const cardContent = [
      `**${rec.refundId || "VRP-R-000000"}** • **${catLabel}**`,
      dateStr,
      detailsLine + reasonLine,
      "",
      `-# Logged by ${rec.staffName || "Staff"}`,
    ].join("\n");

    innerComponents.push({
      type: ComponentType.TEXT_DISPLAY,
      content: cardContent,
    });

    // View Refund button (Link) if jump URL exists
    if (rec.discordJumpUrl && isValidUrl(rec.discordJumpUrl)) {
      innerComponents.push({
        type: ComponentType.ACTION_ROW,
        components: [
          {
            type: ComponentType.BUTTON,
            style: ButtonStyle.LINK,
            url: rec.discordJumpUrl,
            label: "View Refund",
            emoji: { name: "🔗" },
          },
        ],
      });
    }
  }

  // Pagination (if total records > pageSize)
  if (totalPages > 1) {
    innerComponents.push({
      type: ComponentType.SEPARATOR,
      divider: true,
      spacing: 1,
    });

    const startNum = startIndex + 1;
    const endNum = Math.min(startIndex + pageSize, totalCount);

    innerComponents.push({
      type: ComponentType.TEXT_DISPLAY,
      content: `Showing ${startNum}-${endNum} of ${totalCount}`,
    });

    innerComponents.push({
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          custom_id: buildRefundHistoryPageCustomId(playerDiscordId, currentPage - 1),
          label: "← Previous",
          style: ButtonStyle.SECONDARY,
          disabled: currentPage <= 1,
        },
        {
          type: ComponentType.BUTTON,
          custom_id: buildRefundHistoryPageCustomId(playerDiscordId, currentPage + 1),
          label: "Next →",
          style: ButtonStyle.SECONDARY,
          disabled: currentPage >= totalPages,
        },
      ],
    });
  }

  // Footer separator & text
  innerComponents.push({
    type: ComponentType.SEPARATOR,
    divider: true,
    spacing: 1,
  });

  innerComponents.push({
    type: ComponentType.TEXT_DISPLAY,
    content: `-# 🤖 Damo Bot • Refund Manager • ${DAMO_BOT_VERSION}`,
  });

  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: innerComponents,
  };
}

/**
 * Notice container when a refund record is not found.
 * @returns {Object} Components V2 Container
 */
export function buildRefundRecordNotFoundContainer() {
  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content:
          "⚠️ **Refund Record Not Found**\n\nThis refund record could no longer be found.\n\nPlease reopen the Refund Center and try again.",
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Refund Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Notice container when a refund record has no Player Discord ID attached.
 * @returns {Object} Components V2 Container
 */
export function buildRefundHistoryUnavailableContainer() {
  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content:
          "⚠️ **Refund History Unavailable**\n\nThis refund record does not have a Discord user attached, so Damo-Bot cannot reliably search this player's refund history.",
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Refund Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

/**
 * Notice container when no refund history is found for the player.
 * @param {Object} [options]
 * @returns {Object} Components V2 Container
 */
export function buildNoRefundHistoryContainer() {
  return {
    type: ComponentType.CONTAINER,
    accent_color: VITAL_ORANGE,
    components: [
      {
        type: ComponentType.TEXT_DISPLAY,
        content:
          "ℹ️ **No Refund History**\n\nNo previous refund records were found for this player.",
      },
      {
        type: ComponentType.SEPARATOR,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.TEXT_DISPLAY,
        content: `-# 🤖 Damo Bot • Refund Manager • ${DAMO_BOT_VERSION}`,
      },
    ],
  };
}

