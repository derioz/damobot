/**
 * Referral System Configuration.
 * Centralized, editable configuration for player referrals and tracker synchronization.
 *
 * Controls:
 * - Referral submission and logging channel restrictions (empty string means allowed anywhere)
 * - Staff and manager roles permitted to audit or manage referrals
 * - Superadmin user IDs with full access
 * - Eligibility requirements (minimum account age, minimum playtime)
 * - Anti-duplicate submission settings
 * - Google Sheets tracker destination
 */

export const referralConfig = {
  // Master switch for the Referral feature
  enabled: true,

  // Discord channel IDs
  channels: {
    // Channel where /referral is allowed (leave empty "" to allow across all server channels)
    referrals: "",

    // Channel where referral logs or notifications are posted (leave empty if not using Discord logs)
    logs: "",
  },

  // Discord role IDs with permission to access/manage referral audits
  roles: {
    // Roles allowed to view staff referral tools
    allowed: [
      "743422836223246366", // Staff Team
      "743423786275307542", // Owner
    ],

    // Roles allowed to manage/resolve referrals
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

  // Eligibility rules for referral rewards
  requirements: {
    accountAgeDays: 30, // Minimum account age required for reward eligibility
    minimumPlaytimeHours: 10, // Minimum in-game playtime hours required
  },

  // Referral behavior settings
  settings: {
    preventDuplicateReferrals: true, // Prevent a player from submitting multiple referrals
    sheetId: "1pMPhLNXdLGSPCVvy_ZKZyU6OkTWP6wZBC-s_f310_xM", // Google Sheets tracker spreadsheet ID
    sheetTab: "Referral Tracker", // Google Sheets tracker tab name
  },
};
