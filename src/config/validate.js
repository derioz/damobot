/**
 * Configuration Validator.
 * Performs startup sanity checks on Refund, LOA, and Referral configs.
 * Logs actionable warnings with `[Damo Bot Config]` prefix without crashing the worker.
 */

import { refundConfig } from "./refund.config.js";
import { loaConfig } from "./loa.config.js";
import { referralConfig } from "./referral.config.js";

/**
 * Validate all configuration modules and log warnings.
 *
 * @param {Object} [options]
 * @param {Object} [options.refund=refundConfig]
 * @param {Object} [options.loa=loaConfig]
 * @param {Object} [options.referral=referralConfig]
 * @param {boolean} [options.silent=false]
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateBotConfig(options = {}) {
  const refund = options.refund || refundConfig;
  const loa = options.loa || loaConfig;
  const referral = options.referral || referralConfig;
  const silent = options.silent === true;

  const warnings = [];

  function warn(msg) {
    warnings.push(msg);
    if (!silent) {
      console.warn(`[Damo Bot Config] ${msg}`);
    }
  }

  // --- 1. REFUND CONFIG VALIDATION ---
  if (!refund) {
    warn("Refund configuration (refundConfig) is missing.");
  } else {
    // Channels
    if (!refund.channels?.center) {
      warn("Refund Center channel ID is missing.");
    }
    if (!refund.channels?.logs) {
      warn("Refund log channel ID is missing.");
    }

    // Roles
    if (!Array.isArray(refund.roles?.allowed) || refund.roles.allowed.length === 0) {
      warn("Refund allowed roles array is empty or missing.");
    } else {
      const seenRoles = new Set();
      for (const r of refund.roles.allowed) {
        if (seenRoles.has(r)) {
          warn(`Duplicate role ID in refundConfig.roles.allowed: ${r}`);
        }
        seenRoles.add(r);
      }
    }

    if (Array.isArray(refund.roles?.managers)) {
      const seenMgrs = new Set();
      for (const r of refund.roles.managers) {
        if (seenMgrs.has(r)) {
          warn(`Duplicate role ID in refundConfig.roles.managers: ${r}`);
        }
        seenMgrs.add(r);
      }
    }

    // Categories
    if (!Array.isArray(refund.categories) || refund.categories.length === 0) {
      warn("No refund categories configured in refundConfig.categories.");
    } else {
      const seenCategoryIds = new Set();
      let enabledCount = 0;

      for (const cat of refund.categories) {
        if (!cat.id || !String(cat.id).trim()) {
          warn("A refund category is missing an 'id'.");
          continue;
        }

        const normalizedId = cat.id.toLowerCase().trim();
        if (seenCategoryIds.has(normalizedId)) {
          warn(`Duplicate refund category ID: ${cat.id}`);
        }
        seenCategoryIds.add(normalizedId);

        if (!cat.label || !String(cat.label).trim()) {
          warn(`Refund category '${cat.id}' is missing a 'label'.`);
        }

        if (cat.enabled !== false) {
          enabledCount++;
        }
      }

      if (enabledCount > 25) {
        warn(
          `More than 25 active refund categories (${enabledCount}) are enabled. Discord select menus support a maximum of 25 options.`
        );
      }
    }

    // Settings
    if (
      refund.settings?.maxOpenRequestsPerUser != null &&
      Number(refund.settings.maxOpenRequestsPerUser) <= 0
    ) {
      warn("refundConfig.settings.maxOpenRequestsPerUser must be greater than 0.");
    }
  }

  // --- 2. LOA CONFIG VALIDATION ---
  if (!loa) {
    warn("LOA configuration (loaConfig) is missing.");
  } else {
    // Channels
    if (!loa.channels?.center) {
      warn("LOA Center channel ID is missing.");
    }
    if (!loa.channels?.logs) {
      warn("LOA log channel ID is missing.");
    }

    // Roles
    if (!Array.isArray(loa.roles?.allowed) || loa.roles.allowed.length === 0) {
      warn("LOA allowed roles array is empty or missing.");
    } else {
      const seenRoles = new Set();
      for (const r of loa.roles.allowed) {
        if (seenRoles.has(r)) {
          warn(`Duplicate role ID in loaConfig.roles.allowed: ${r}`);
        }
        seenRoles.add(r);
      }
    }

    // Settings
    const minDays = loa.settings?.minimumDays;
    const maxDays = loa.settings?.maximumDays;

    if (minDays != null && (Number(minDays) <= 0 || !Number.isInteger(minDays))) {
      warn("loaConfig.settings.minimumDays must be a positive integer.");
    }
    if (maxDays != null && (Number(maxDays) <= 0 || !Number.isInteger(maxDays))) {
      warn("loaConfig.settings.maximumDays must be a positive integer.");
    }
    if (
      minDays != null &&
      maxDays != null &&
      Number(minDays) > Number(maxDays)
    ) {
      warn(
        `loaConfig.settings.minimumDays (${minDays}) cannot be greater than maximumDays (${maxDays}).`
      );
    }
  }

  // --- 3. REFERRAL CONFIG VALIDATION ---
  if (!referral) {
    warn("Referral configuration (referralConfig) is missing.");
  } else {
    // Roles
    if (Array.isArray(referral.roles?.allowed)) {
      const seenRoles = new Set();
      for (const r of referral.roles.allowed) {
        if (seenRoles.has(r)) {
          warn(`Duplicate role ID in referralConfig.roles.allowed: ${r}`);
        }
        seenRoles.add(r);
      }
    }

    // Requirements
    if (
      referral.requirements?.accountAgeDays != null &&
      Number(referral.requirements.accountAgeDays) < 0
    ) {
      warn("referralConfig.requirements.accountAgeDays cannot be negative.");
    }
    if (
      referral.requirements?.minimumPlaytimeHours != null &&
      Number(referral.requirements.minimumPlaytimeHours) < 0
    ) {
      warn("referralConfig.requirements.minimumPlaytimeHours cannot be negative.");
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Validate Cloudflare Worker runtime environment, bindings, and credentials.
 * Fails safely and logs actionable setup warnings without leaking secret values.
 *
 * @param {Object} env Cloudflare Worker environment object
 * @param {Object} [options]
 * @param {boolean} [options.silent=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateEnvironment(env = {}, options = {}) {
  const silent = options.silent === true;
  const errors = [];
  const warnings = [];

  function err(msg) {
    errors.push(msg);
    if (!silent) {
      console.error(`[Damo Bot Setup Error] ${msg}`);
    }
  }

  function warn(msg) {
    warnings.push(msg);
    if (!silent) {
      console.warn(`[Damo Bot Setup Warning] ${msg}`);
    }
  }

  // 1. Required Discord Credentials
  if (!env.DISCORD_PUBLIC_KEY) {
    err(
      "Missing required environment variable: DISCORD_PUBLIC_KEY (Inbound Discord webhooks will be rejected with 401)."
    );
  } else if (
    typeof env.DISCORD_PUBLIC_KEY !== "string" ||
    env.DISCORD_PUBLIC_KEY.length < 32
  ) {
    warn(
      "DISCORD_PUBLIC_KEY appears invalid or malformed (expected 64-char hex string from Discord Developer Portal)."
    );
  }

  if (!env.DISCORD_APPLICATION_ID) {
    warn(
      "Missing environment variable: DISCORD_APPLICATION_ID (Command registration and interaction links may fail)."
    );
  }

  // 2. Cloudflare D1 Database Bindings
  if (!env.PUNISHMENT_DB) {
    warn(
      "Missing Cloudflare D1 binding: env.PUNISHMENT_DB. Punishment logging will operate without database persistence."
    );
  }
  if (!env.REFUND_DB) {
    warn(
      "Missing Cloudflare D1 binding: env.REFUND_DB. Refund records will operate without database persistence."
    );
  }

  // 3. Cloudflare Durable Object Bindings
  if (!env.STICKY_BOT) {
    warn(
      "Missing Durable Object binding: env.STICKY_BOT. Sticky message channel synchronization will be disabled."
    );
  }
  if (!env.STAFF_LOA) {
    warn(
      "Missing Durable Object binding: env.STAFF_LOA. Staff LOA tracking will be disabled."
    );
  }
  if (!env.PUNISHMENT_SEQUENCE) {
    warn(
      "Missing Durable Object binding: env.PUNISHMENT_SEQUENCE. Sequential punishment case IDs will not increment."
    );
  }
  if (!env.SUGGESTIONS) {
    warn(
      "Missing Durable Object binding: env.SUGGESTIONS. Suggestion voting and cooldowns will be disabled."
    );
  }

  // 4. Role ID Snowflakes
  const roleChecks = [
    { key: "STAFF_TEAM_ROLE_ID", name: "Staff Team Role" },
    { key: "OWNER_ROLE_ID", name: "Owner Role" },
  ];
  for (const { key, name } of roleChecks) {
    if (env[key] && !/^\d{17,20}$/.test(String(env[key]).trim())) {
      warn(
        `Environment variable '${key}' (${name}) does not look like a valid Discord snowflake ID.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
