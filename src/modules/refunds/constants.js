/**
 * Constants for Staff Refund Center
 */

import {
  refundConfig,
  getRefundCategoryConfig,
  getActiveRefundCategoryOptions,
} from "../../config/refund.config.js";

export {
  refundConfig,
  getRefundCategoryConfig,
  getActiveRefundCategoryOptions,
};

export const DEFAULT_REFUND_LOG_CHANNEL_ID =
  refundConfig.channels?.logs || "1289638609535766631";
export const DEFAULT_STAFF_TEAM_ROLE_ID =
  refundConfig.roles?.allowed?.[0] || "743422836223246366";
export const DEFAULT_OWNER_ROLE_ID =
  refundConfig.roles?.managers?.[0] || "743423786275307542";

export const DEFAULT_REFUND_SHEET_TAB =
  refundConfig.settings?.sheetTab || "Refund Log";
export const DEFAULT_REFUND_AUDIT_TAB =
  refundConfig.settings?.auditTab || "Refund Audits";

export const RefundCategory = new Proxy({}, {
  get(target, prop) {
    if (typeof prop === "string") {
      const match = refundConfig.categories.find(
        (c) => c.id.toUpperCase() === prop.toUpperCase()
      );
      if (match) return match.id;
    }
    return prop;
  },
});

/**
 * Dynamic category options array proxy.
 * Reflects live changes to refundConfig.categories while preserving Array semantics.
 */
export const REFUND_CATEGORY_OPTIONS = new Proxy([], {
  get(target, prop, receiver) {
    const opts = getActiveRefundCategoryOptions();
    if (prop === "length") return opts.length;
    if (typeof prop === "symbol") return Reflect.get(opts, prop, receiver);
    if (!isNaN(Number(prop))) return opts[Number(prop)];
    const val = Reflect.get(opts, prop, receiver);
    if (typeof val === "function") {
      return val.bind(opts);
    }
    return val;
  },
  has(target, prop) {
    const opts = getActiveRefundCategoryOptions();
    return prop in opts;
  },
  ownKeys() {
    const opts = getActiveRefundCategoryOptions();
    return Reflect.ownKeys(opts);
  },
  getOwnPropertyDescriptor(target, prop) {
    const opts = getActiveRefundCategoryOptions();
    return Object.getOwnPropertyDescriptor(opts, prop);
  },
});


export const RefundCustomId = {
  // Center main action buttons
  BTN_LOG: "refund_btn_log",
  BTN_SEARCH: "refund_btn_search",
  BTN_RECENT: "refund_btn_recent",
  BTN_MY_LOGS: "refund_btn_my_logs",

  // Workflow selectors and controls
  USER_SELECT: "refund_select_user",
  BTN_MANUAL: "refund_btn_manual",
  BTN_DISMISS: "refund_btn_dismiss",

  // Modals
  MODAL_SUBMIT_PREFIX: "refund_modal_submit:",
  MODAL_MANUAL_SUBMIT: "refund_modal_manual_submit",
  MODAL_SEARCH: "refund_modal_search",
  MODAL_EDIT_PREFIX: "refund_modal_edit:",

  // Edit action
  BTN_EDIT_PREFIX: "refund_edit:",

  // Results navigation and filtering
  BTN_PAGE_PREFIX: "refund_page:",
  BTN_FILTER_PREFIX: "refund_filter:",
  BTN_PLAYER_HISTORY_PREFIX: "refund_hist:",
  BTN_PLAYER_HISTORY_PAGE_PREFIX: "refund_hist_page:",

  // Sticky command integration button
  STICKY_BUTTON: "sticky:refund_center",
};

/**
 * Build centralized custom_id for a refund player history button.
 * Supports passing refundId and optional playerDiscordId.
 *
 * @param {string} refundId
 * @param {string} [playerDiscordId]
 * @returns {string}
 */
export function buildRefundPlayerHistoryCustomId(refundId, playerDiscordId) {
  if (playerDiscordId && /^\d{17,20}$/.test(playerDiscordId)) {
    return `${RefundCustomId.BTN_PLAYER_HISTORY_PREFIX}${refundId}:${playerDiscordId}`;
  }
  return `${RefundCustomId.BTN_PLAYER_HISTORY_PREFIX}${refundId || "UNKNOWN"}`;
}

/**
 * Build centralized custom_id for refund player history pagination.
 * @param {string} playerDiscordId
 * @param {number} page
 * @returns {string}
 */
export function buildRefundHistoryPageCustomId(playerDiscordId, page) {
  return `${RefundCustomId.BTN_PLAYER_HISTORY_PAGE_PREFIX}${playerDiscordId}:${page}`;
}

/**
 * Parse any refund component custom_id.
 * @param {string} customId
 * @returns {Object}
 */
export function parseRefundComponentCustomId(customId) {
  if (!customId || typeof customId !== "string") {
    return { action: "NONE" };
  }

  if (customId.startsWith(RefundCustomId.BTN_PLAYER_HISTORY_PAGE_PREFIX)) {
    const raw = customId.slice(RefundCustomId.BTN_PLAYER_HISTORY_PAGE_PREFIX.length);
    const [playerDiscordId, pageStr] = raw.split(":");
    return {
      action: "PLAYER_HISTORY_PAGE",
      playerDiscordId: playerDiscordId || "",
      page: parseInt(pageStr, 10) || 1,
    };
  }

  if (customId.startsWith(RefundCustomId.BTN_PLAYER_HISTORY_PREFIX)) {
    const rawKey = customId.slice(RefundCustomId.BTN_PLAYER_HISTORY_PREFIX.length);
    let refundId = rawKey;
    let playerDiscordId = "";
    if (rawKey.includes(":")) {
      const parts = rawKey.split(":");
      refundId = parts[0];
      playerDiscordId = parts[1];
    }
    return {
      action: "PLAYER_HISTORY",
      rawKey: rawKey || "",
      refundId: refundId || "",
      playerDiscordId: playerDiscordId || "",
    };
  }

  if (customId === RefundCustomId.BTN_LOG) return { action: "BTN_LOG" };
  if (customId === RefundCustomId.BTN_SEARCH) return { action: "BTN_SEARCH" };
  if (customId === RefundCustomId.BTN_RECENT) return { action: "BTN_RECENT" };
  if (customId === RefundCustomId.BTN_MY_LOGS) return { action: "BTN_MY_LOGS" };
  if (customId === RefundCustomId.USER_SELECT) return { action: "USER_SELECT" };
  if (customId === RefundCustomId.BTN_MANUAL) return { action: "BTN_MANUAL" };
  if (customId === RefundCustomId.BTN_DISMISS) return { action: "BTN_DISMISS" };

  if (customId.startsWith(RefundCustomId.BTN_FILTER_PREFIX)) {
    const raw = customId.slice(RefundCustomId.BTN_FILTER_PREFIX.length);
    const [category, encodedQueryKey] = raw.split(":");
    return {
      action: "FILTER",
      category: category || "All",
      queryKey: decodeURIComponent(encodedQueryKey || ""),
    };
  }

  if (customId.startsWith(RefundCustomId.BTN_PAGE_PREFIX)) {
    const raw = customId.slice(RefundCustomId.BTN_PAGE_PREFIX.length);
    const [direction, encodedQueryKey, categoryFilter, targetPageStr] = raw.split(":");
    return {
      action: "PAGE",
      direction: direction || "next",
      queryKey: decodeURIComponent(encodedQueryKey || ""),
      categoryFilter: categoryFilter || "All",
      page: parseInt(targetPageStr, 10) || 1,
    };
  }

  if (customId.startsWith(RefundCustomId.BTN_EDIT_PREFIX)) {
    return {
      action: "BTN_EDIT",
      refundId: customId.slice(RefundCustomId.BTN_EDIT_PREFIX.length),
    };
  }

  if (customId.startsWith("refund_")) {
    return { action: "UNKNOWN" };
  }

  return { action: "NONE" };
}


export const SyncStatus = {
  PENDING: "Pending",
  POSTED: "Posted",
  POST_FAILED: "Post Failed",
};

export const AuditAction = {
  CREATED: "CREATED",
  EDITED: "EDITED",
  POST_FAILED: "POST_FAILED",
  SYNC_RETRY: "SYNC_RETRY",
};

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  USER_SELECT: 5,
  ROLE_SELECT: 6,
  MENTIONABLE_SELECT: 7,
  CHANNEL_SELECT: 8,
  SECTION: 9,
  TEXT_DISPLAY: 10,
  THUMBNAIL: 11,
  MEDIA_GALLERY: 12,
  FILE: 13,
  SEPARATOR: 14,
  CONTAINER: 17,
  LABEL: 18,
  FILE_UPLOAD: 19,
};

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
};

export const IS_COMPONENTS_V2_FLAG = 32768; // 1 << 15
export const EPHEMERAL_FLAG = 64; // 1 << 6
export const VITAL_ORANGE = 16425472; // #FAA200

export const REFUND_SHEET_COLUMNS = [
  "Refund ID",
  "Created At",
  "Player Name",
  "Player Discord ID",
  "Refund Category",
  "Refund Details",
  "Reason",
  "Ticket URL",
  "Staff Name",
  "Staff Discord ID",
  "Guild ID",
  "Log Channel ID",
  "Log Message ID",
  "Discord Jump URL",
  "Sync Status",
  "Normalized Player Name",
];
