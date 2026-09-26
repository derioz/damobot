/**
 * Central configuration for Damo Bot.
 * Single source of truth for application versioning, brand assets, and defaults.
 */

// Canonical application version (single source of truth for all Components V2 interfaces)
// Note: Kept here directly for scripts/bump-version.js compatibility.
export const DAMO_BOT_VERSION = "v0.9.85-beta";

// Re-export modular configuration domains
export {
  VITAL_RP_LOGO_URL,
  DAMO_BOT_LOGO_URL,
  VITAL_ORANGE,
  DEFAULT_COMMUNITY_NAME,
  DEFAULT_COMMUNITY_SHORT_NAME,
  DEFAULT_COMMUNITY_WEBSITE_URL,
  getCommunityName,
  getCommunityShortName,
  getCommunityWebsiteUrl,
  getCommunityLogoUrl,
  getBrandColor,
} from "./config/brand.js";
export {
  DEFAULT_STAFF_TEAM_ROLE_ID,
  DEFAULT_OWNER_ROLE_ID,
  DEFAULT_VRP_MANAGEMENT_ROLE_ID,
  DEFAULT_ADMINISTRATOR_ROLE_ID,
  DEFAULT_ADMIN_ROLE_ID,
  DEFAULT_STAFF_LOA_ROLE_ID,
  DEFAULT_ROLE_WHITELIST_APPROVED,
  DEFAULT_ROLE_KEYBOARD_WARRIOR,
  DEFAULT_ROLE_GIF,
  DEFAULT_ROLE_MEMBER,
} from "./config/roles.js";
export {
  DEFAULT_LOA_CHANNEL_ID,
  DEFAULT_LOA_LOG_CHANNEL_ID,
  DEFAULT_ADMIN_CHAT_CHANNEL_ID,
  DEFAULT_PUNISHMENT_LOG_CHANNEL_ID,
  DEFAULT_REFUND_LOG_CHANNEL_ID,
  DEFAULT_GUILD_ID,
  DEFAULT_SUGGESTIONS_CHANNEL_ID,
  TEST_SUGGESTIONS_CHANNEL_ID,
  PRODUCTION_SUGGESTIONS_CHANNEL_ID,
} from "./config/channels.js";
export {
  DEFAULT_REFERRAL_SHEET_ID,
  DEFAULT_REFERRAL_SHEET_TAB,
  DEFAULT_PUNISHMENT_SHEET_ID,
  DEFAULT_PUNISHMENT_SHEET_TAB,
  DEFAULT_PUNISHMENT_AUDIT_TAB,
  DEFAULT_REFUND_SHEET_TAB,
  DEFAULT_REFUND_AUDIT_TAB,
} from "./config/sheets.js";

// Feature-specific easy-to-edit configuration modules
export {
  refundConfig,
  getRefundCategoryConfig,
  getActiveRefundCategoryOptions,
  REFUND_CATEGORY_OPTIONS,
} from "./config/refund.config.js";
export { loaConfig } from "./config/loa.config.js";
export { referralConfig } from "./config/referral.config.js";
export {
  suggestionsConfig,
  getActiveCategoryOptions as getActiveSuggestionCategoryOptions,
  getCategoryById as getSuggestionCategoryById,
} from "./config/suggestions.config.js";
export {
  ADMIN_CHAT_RESPONSES,
  getRandomAdminResponse,
} from "./config/adminChatResponses.js";

// Role & Channel configuration helpers
export {
  hasAnyRole,
  canManageRefunds,
  canManageLOAs,
  hasStaffLoaRole,
  canViewLoaHistory,
  canManageReferrals,
  isRefundCenterChannel,
  isLOACenterChannel,
  isLOALogChannel,
  isReferralChannel,
  isSuperadmin,
  getLoaConfig,
} from "./config/helpers.js";

// Configuration sanity validator
export { validateBotConfig, validateEnvironment } from "./config/validate.js";
