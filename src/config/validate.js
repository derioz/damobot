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
