/**
 * Refund Center Configuration.
 * Centralized, editable configuration for the Staff Refund Center.
 *
 * This configuration is the SINGLE SOURCE OF TRUTH for:
 * - Refund Center and Logging Discord channels
 * - Staff and manager roles permitted to issue or review refunds
 * - Superadmin users with unrestricted access
 * - Dynamic refund categories (select menus, modals, logs, embeds, and filters)
 * - Operational settings and limits
 */

export const refundConfig = {
  // Master switch for the Refund Center feature
  enabled: true,

  // Discord channel IDs
  channels: {
    center: "1289638609535766631",
    logs: "1289638609535766631",
  },

  // Discord role IDs with permission to access/manage refunds
  roles: {
    // Roles allowed to open Refund Center and submit refund requests
    allowed: [
      "743422836223246366", // Staff Team
      "743423786275307542", // Owner
    ],

    // Roles allowed to manage/approve/deny refunds
    managers: [
      "743423786275307542", // Owner
    ],
  },

  // Discord user IDs with bot superadmin access
  users: {
    superadmins: [
      "150580708144840704", // Damon (Bot Superadmin)
    ],
  },

  // Dynamic refund categories (SINGLE SOURCE OF TRUTH)
  // Adding, updating, or disabling categories here automatically updates the UI, modals, logs, and filters.
  // The 'id' field is the stable internal identifier stored in records; 'label' is the user-facing name.
  categories: [
    {
      id: "Vitcoin",
      label: "Vitcoin",
      emoji: "🪙",
      logLabel: "Vitcoin",
      description: "In-game Vitcoin currency refund",
      enabled: true,
    },
    {
      id: "Cash",
      label: "Cash",
      emoji: "💵",
      logLabel: "Cash",
      description: "In-game cash currency refund",
      enabled: true,
    },
    {
      id: "S-Coin",
      label: "S-Coin",
      emoji: "💎",
      logLabel: "S-Coin",
      description: "",
      enabled: true,
    },
    {
      id: "Other",
      label: "Other",
      emoji: "📦",
      logLabel: "Other",
      description: "Custom item, vehicle, weapon, or other refund",
      enabled: true,
    },
  ],

  // Refund Center operational settings and limits
  settings: {
    maxOpenRequestsPerUser: 1,
    maxCategoriesPerSelectMenu: 25, // Discord select menu item limit
    sheetId: "1CxMo8nLs_Ln6siVPOk4oqSwjgQr3E0GzKdZZHPVbvm0",
    sheetTab: "Refund Log",
    auditTab: "Refund Audits",
  },
};

/**
 * Retrieve the configuration object for a specific category ID.
 * Returns safe fallback for old, disabled, or unknown category IDs so historical
 * refunds remain readable and staff can continue viewing them.
 *
 * @param {string} categoryId Internal category ID
 * @returns {{ id: string, label: string, emoji: string, logLabel: string, description: string, enabled: boolean }}
 */
export function getRefundCategoryConfig(categoryId) {
  const rawId = String(categoryId || "").trim();
  if (!rawId) {
    return {
      id: "Other",
      label: "Other",
      emoji: "📦",
      logLabel: "Other",
      description: "",
      enabled: true,
    };
  }

  // Look up by exact match first, then case-insensitive match
  const found =
    refundConfig.categories.find((cat) => cat.id === rawId) ||
    refundConfig.categories.find(
      (cat) => cat.id.toLowerCase() === rawId.toLowerCase()
    );

  if (found) {
    return found;
  }

  // Safe fallback for old / unrecognized category IDs
  return {
    id: rawId,
    label: `Unknown Category (${rawId})`,
    emoji: "📦",
    logLabel: `Unknown Category (${rawId})`,
    description: "",
    enabled: false,
  };
}

/**
 * Build Discord String Select Menu options for active refund categories.
 * Only categories with `enabled: true` are returned.
 * Clamped to Discord's maximum limit of 25 options.
 *
 * @returns {Array<{ label: string, value: string, description?: string, emoji?: { name: string } }>}
 */
export function getActiveRefundCategoryOptions() {
  const active = refundConfig.categories.filter((cat) => cat.enabled !== false);

  if (active.length > 25) {
    console.warn(
      `[Damo Bot Config] Discord select menus support at most 25 options. ${active.length} categories configured; truncating to 25.`
    );
  }

  return active.slice(0, 25).map((cat) => {
    const opt = {
      label: cat.label || cat.id,
      value: cat.id,
    };

    if (cat.description && cat.description.trim()) {
      opt.description = cat.description.trim();
    }

    if (cat.emoji && typeof cat.emoji === "string") {
      opt.emoji = { name: cat.emoji.trim() };
    }

    return opt;
  });
}

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

