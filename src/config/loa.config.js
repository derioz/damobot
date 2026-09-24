/**
 * LOA Center Configuration.
 * Centralized, editable configuration for the Staff Leave of Absence (LOA) Manager.
 *
 * Controls:
 * - LOA Center channel (1546281163247722516)
 * - LOA logging and alert channel
 * - Staff roles allowed to request and view LOAs
 * - Manager roles allowed to approve, deny, or manage all staff LOAs
 * - Superadmin user IDs with full access
 * - Duration limits (minimum/maximum days)
 * - Capability toggles (edit active LOA, end LOA early)
 */

export const loaConfig = {
  // Master switch for the LOA Center feature
  enabled: true,

  // Dedicated LOA roles applied while a member is on leave:
  // - moderator: assigned to lower staff who were Moderators (grants access to Mod Chat and Support Chat)
  // - support: assigned to lower staff who were Support (grants access to Support Chat only)
  loaRoles: {
    moderator: "1546696583976980541", // LOA - Moderator
    support: "1547049587993223229",   // LOA - Support
  },

  // Dedicated Staff LOA role ID (maintained for backward compatibility with existing tests/handlers)
  staffLoaRoleId: "1546696583976980541",

  // Protected Leadership Staff Roles (Administrator and above)
  // Staff holding any of these roles:
  // - NEVER have their staff roles removed during LOA
  // - Do NOT receive an LOA role (no role modifications whatsoever)
  // - Only have their Discord nickname changed to LOA format
  // - On return, only have their nickname restored (roles 100% untouched)
  protectedRoleIds: [
    "733091115577901158",  // Administrator
    "1513635168353779915", // Head of Staff
    "738193447017513002",  // [VRP] Management
    "733090996660863056",  // Senior Administrator
    "1251959011872342057", // Head Administrator
  ],

  // Lower Staff Qualification Roles (checked against pre-LOA snapshot to assign correct LOA role)
  staffRoles: {
    moderatorIds: [
      "733091376832708689", // Moderator
    ],
    supportIds: [
      "733091380540473384", // Support Staff
    ],
  },

  // Preserved Standard Player Roles (never snapshotted, removed, or touched)
  preservedRoleIds: [
    "1241050651677556806", // Whitelist Approved
    "1371677888964726818", // Keyboard Warrior
    "735479005561618452",  // Gif
    "733384365513506856",  // Member
  ],

  // Discord channel IDs
  channels: {
    // LOA Center interactive panel channel
    center: "1546281163247722516",
    loaCenter: "1546281163247722516",

    // Dedicated private audit log channel for LOA events
    logs: "1546698584613715998",
    loaLog: "1546698584613715998",

    // Support Chat channel
    supportChat: "1220039518279827528",

    // Moderator Chat channel
    moderatorChat: "1215416531257794621",
  },

  // Role IDs with permission to access, view, or manage LOAs
  roles: {
    // Staff LOA role applied while away
    staffLoa: "1546696583976980541",

    // Roles allowed to request and manage their own LOAs
    allowed: [
      "743422836223246366",  // Staff Team
      "743423786275307542",  // Owner
      "733091115577901158",  // Administrator
      "1513635168353779915", // Head of Staff
      "738193447017513002",  // [VRP] Management
      "733090996660863056",  // Senior Administrator
      "1251959011872342057", // Head Administrator
      "733091376832708689",  // Moderator
      "733091380540473384",  // Support Staff
    ],

    // Roles allowed to manage all staff LOAs
    managers: [
      "743423786275307542",  // Owner
      "738193447017513002",  // VRP Management
      "1513635168353779915", // Head of Staff
      "1251959011872342057", // Head Administrator
      "733090996660863056",  // Senior Administrator
      "733091115577901158",  // Administrator
    ],

    // Roles permitted to view LOA role snapshots and member LOA history
    adminViewers: [
      "738193447017513002",  // VRP Management
      "743423786275307542",  // Owner
      "1513635168353779915", // Head of Staff
      "1251959011872342057", // Head Administrator
      "733090996660863056",  // Senior Administrator
      "733091115577901158",  // Administrator
    ],
  },

  // Discord user IDs with bot superadmin access
  users: {
    superadmins: [
      "150580708144840704", // Damon (Bot Superadmin)
    ],
  },

  // Duration rules and user capability settings
  settings: {
    minimumDays: 1, // Minimum allowable LOA duration
    maximumDays: 30, // Maximum allowable LOA duration in a single request
    allowEarlyEnd: true, // Whether staff can return early and end their own LOA
    allowEdit: true, // Whether staff can edit dates or reason of an existing active LOA
  },
};
