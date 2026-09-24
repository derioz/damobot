/**
 * Centralized Brand & Application Constants.
 */
import { DAMO_BOT_VERSION } from "../config.js";

export { DAMO_BOT_VERSION };

// Public Vital RP logo URL for Components V2 footer Thumbnail accessory
export const VITAL_RP_LOGO_URL =
  "https://r2.fivemanage.com/image/qlWrCeXTQdqx.png";

// Official DamoBot Logo URL
export const DAMO_BOT_LOGO_URL =
  "https://r2.fivemanage.com/image/4sIiNuE1Vmvn.png";

// Official Vital RP Orange Brand Color
export const VITAL_ORANGE = 16425472; // #FAA200

// Default Community Identity Fallbacks
export const DEFAULT_COMMUNITY_NAME = "Vital RP";
export const DEFAULT_COMMUNITY_SHORT_NAME = "VRP";
export const DEFAULT_COMMUNITY_WEBSITE_URL = "http://vitalrp.net";

/**
 * Resolve the configured community/server name with fallback.
 *
 * @param {Object} [env={}]
 * @returns {string}
 */
export function getCommunityName(env = {}) {
  return env?.COMMUNITY_NAME || env?.SERVER_NAME || DEFAULT_COMMUNITY_NAME;
}

/**
 * Resolve the configured community/server short name or acronym with fallback.
 *
 * @param {Object} [env={}]
 * @returns {string}
 */
export function getCommunityShortName(env = {}) {
  return (
    env?.COMMUNITY_SHORT_NAME ||
    env?.SERVER_SHORT_NAME ||
    DEFAULT_COMMUNITY_SHORT_NAME
  );
}

/**
 * Resolve the configured community website URL with fallback.
 *
 * @param {Object} [env={}]
 * @returns {string}
 */
export function getCommunityWebsiteUrl(env = {}) {
  return (
    env?.COMMUNITY_WEBSITE_URL ||
    env?.WEBSITE_URL ||
    DEFAULT_COMMUNITY_WEBSITE_URL
  );
}

/**
 * Resolve the community logo URL with fallback.
 *
 * @param {Object} [env={}]
 * @returns {string}
 */
export function getCommunityLogoUrl(env = {}) {
  return env?.COMMUNITY_LOGO_URL || env?.LOGO_URL || VITAL_RP_LOGO_URL;
}

/**
 * Resolve the integer brand color with fallback.
 *
 * @param {Object} [env={}]
 * @returns {number}
 */
export function getBrandColor(env = {}) {
  if (env?.BRAND_COLOR) {
    if (typeof env.BRAND_COLOR === "number") return env.BRAND_COLOR;
    const clean = String(env.BRAND_COLOR).replace("#", "").trim();
    const parsed = parseInt(clean, 16);
    if (!isNaN(parsed)) return parsed;
  }
  return VITAL_ORANGE;
}

