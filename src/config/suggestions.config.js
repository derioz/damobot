/**
 * Centralized Configuration for the Vital RP Suggestions System.
 * Single source of truth for categories, limits, cooldowns, and channel routing.
 */

import { VITAL_RP_LOGO_URL, VITAL_ORANGE } from "./brand.js";

// Channels: Production channel (1446287220389712024) is the active suggestions channel.
export const TEST_SUGGESTIONS_CHANNEL_ID = "1403073578034921512";
export const PRODUCTION_SUGGESTIONS_CHANNEL_ID = "1446287220389712024";

// Currently active suggestions channel (Production by default)
export const DEFAULT_SUGGESTIONS_CHANNEL_ID = PRODUCTION_SUGGESTIONS_CHANNEL_ID;

/**
 * Suggestions feature configuration.
 */
export const suggestionsConfig = {
  // Channel routing
  channels: {
    testChannelId: TEST_SUGGESTIONS_CHANNEL_ID,
    productionChannelId: PRODUCTION_SUGGESTIONS_CHANNEL_ID,
    // Active channel ID evaluated dynamically from env or falling back to DEFAULT_SUGGESTIONS_CHANNEL_ID
    getActiveChannelId: (env = {}) =>
      env.SUGGESTIONS_CHANNEL_ID || env.DEFAULT_SUGGESTIONS_CHANNEL_ID || DEFAULT_SUGGESTIONS_CHANNEL_ID,
  },

  // Per-user submission cooldown in seconds (Default: 5 minutes / 300 seconds)
  cooldownSeconds: 300,

  // Text length limits
  limits: {
    titleMinLength: 5,
    titleMaxLength: 80,
    descriptionMinLength: 20,
    descriptionMaxLength: 600,
    mySuggestionsLimit: 5,
    topSuggestionsLimit: 5,
    recentSuggestionsLimit: 5,
  },

  // Feature toggles
  features: {
    anonymousEnabled: true,
    urlEnabled: true,
    imageUploadEnabled: true,
    votingEnabled: true,
  },

  // Branding
  branding: {
    logoUrl: VITAL_RP_LOGO_URL,
    color: VITAL_ORANGE,
    suggestionIdPrefix: "VRP-S-",
  },

  // Superadmin user IDs with full setup and administrative permissions
  users: {
    superadmins: [
      "150580708144840704", // Damon (Bot Superadmin)
    ],
  },

  // Configurable Categories (easily reordered, added, renamed, or disabled)
  categories: [
    {
      id: "scripts",
      label: "Scripts",
      emoji: "📜",
      description: "Suggestions regarding server scripts, jobs, and gameplay mechanics",
      enabled: true,
    },
    {
      id: "rule_changes",
      label: "Rule Changes",
      emoji: "⚖️",
      description: "Proposals for server rules, community guidelines, and policy updates",
      enabled: true,
    },
    {
      id: "new_features",
      label: "New Features",
      emoji: "💡",
      description: "Brand new gameplay features, activities, or systems for Vital RP",
      enabled: true,
    },
    {
      id: "server_changes",
      label: "Server Changes",
      emoji: "⚙️",
      description: "General adjustments to server settings, vehicles, or balance",
      enabled: true,
    },
    {
      id: "qol",
      label: "Quality of Life",
      emoji: "✨",
      description: "Small refinements that make the day-to-day player experience better",
      enabled: true,
    },
    {
      id: "other",
      label: "Other",
      emoji: "📌",
      description: "Any suggestions that don't fit into the categories above",
      enabled: true,
    },
  ],
};

/**
 * Get list of currently active category options for Discord Select Menus.
 *
 * @returns {Array<{ label: string, value: string, description: string, emoji: { name: string } }>}
 */
export function getActiveCategoryOptions() {
  return suggestionsConfig.categories
    .filter((cat) => cat.enabled)
    .map((cat) => ({
      label: cat.label,
      value: cat.id,
      description: cat.description,
      emoji: { name: cat.emoji },
    }));
}

/**
 * Get category configuration by ID.
 *
 * @param {string} categoryId
 * @returns {Object|null}
 */
export function getCategoryById(categoryId) {
  if (!categoryId) return null;
  return suggestionsConfig.categories.find((cat) => cat.id === categoryId) || null;
}
