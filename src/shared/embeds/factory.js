/**
 * Shared DamoBot Discord Embed Builders.
 * Standardizes visual identity, branding colors, footers, and state styling.
 */

import {
  VITAL_ORANGE,
  VITAL_RP_LOGO_URL,
  DAMO_BOT_VERSION,
  getCommunityName,
  getCommunityLogoUrl,
} from "../../config/brand.js";

export const EmbedColor = {
  DEFAULT: VITAL_ORANGE, // 16425472 (#FAA200)
  SUCCESS: 5763719,      // Discord Green (#57F287)
  ERROR: 15548997,       // Discord Red (#ED4245)
  WARNING: 16705372,     // Discord Amber / Yellow (#FEE75C)
  INFO: 5793266,         // Discord Blurple (#5865F2)
};

/**
 * Build a standard DamoBot Discord embed.
 *
 * @param {Object} options
 * @param {string} [options.title]
 * @param {string} [options.description]
 * @param {number} [options.color=VITAL_ORANGE]
 * @param {Array<Object>} [options.fields]
 * @param {string} [options.footerText]
 * @param {string} [options.footerIconUrl]
 * @param {string|Date} [options.timestamp]
 * @param {string|Object} [options.thumbnail]
 * @param {string|Object} [options.image]
 * @param {Object} [options.author]
 * @param {string} [options.url]
 * @param {Object} [options.env] Cloudflare environment for community branding
 * @returns {Object} Discord Embed object
 */
export function createDamoEmbed({
  title,
  description,
  color = EmbedColor.DEFAULT,
  fields = [],
  footerText,
  footerIconUrl,
  timestamp = new Date().toISOString(),
  thumbnail,
  image,
  author,
  url,
  env,
} = {}) {
  const communityName = getCommunityName(env);
  const resolvedFooterText =
    footerText ?? `Damo-Bot ${DAMO_BOT_VERSION} • ${communityName}`;
  const resolvedFooterIcon = footerIconUrl ?? getCommunityLogoUrl(env);

  const embed = {
    color,
    timestamp: timestamp instanceof Date ? timestamp.toISOString() : timestamp,
  };

  if (title) embed.title = title;
  if (description) embed.description = description;
  if (url) embed.url = url;

  if (Array.isArray(fields) && fields.length > 0) {
    embed.fields = fields.filter((f) => f && f.name && f.value !== undefined);
  }

  if (resolvedFooterText) {
    embed.footer = {
      text: resolvedFooterText,
      icon_url: resolvedFooterIcon,
    };
  }

  if (thumbnail) {
    embed.thumbnail = typeof thumbnail === "string" ? { url: thumbnail } : thumbnail;
  }

  if (image) {
    embed.image = typeof image === "string" ? { url: image } : image;
  }

  if (author) {
    embed.author = author;
  }

  return embed;
}

/**
 * Build a Success-state embed (Green #57F287).
 *
 * @param {Object} options
 * @returns {Object} Discord Embed object
 */
export function createSuccessEmbed({
  title = "Success",
  description,
  fields = [],
  footerText,
  footerIconUrl,
  timestamp,
  thumbnail,
  image,
} = {}) {
  const normalizedTitle = title.startsWith("✅") ? title : `✅ ${title}`;
  return createDamoEmbed({
    title: normalizedTitle,
    description,
    color: EmbedColor.SUCCESS,
    fields,
    footerText,
    footerIconUrl,
    timestamp,
    thumbnail,
    image,
  });
}

/**
 * Build an Error-state embed (Red #ED4245).
 *
 * @param {Object} options
 * @returns {Object} Discord Embed object
 */
export function createErrorEmbed({
  title = "Error",
  description,
  fields = [],
  footerText,
  footerIconUrl,
  timestamp,
  thumbnail,
  image,
} = {}) {
  const normalizedTitle = title.startsWith("❌") ? title : `❌ ${title}`;
  return createDamoEmbed({
    title: normalizedTitle,
    description,
    color: EmbedColor.ERROR,
    fields,
    footerText,
    footerIconUrl,
    timestamp,
    thumbnail,
    image,
  });
}

/**
 * Build a Warning-state embed (Amber #FEE75C).
 *
 * @param {Object} options
 * @returns {Object} Discord Embed object
 */
export function createWarningEmbed({
  title = "Warning",
  description,
  fields = [],
  footerText,
  footerIconUrl,
  timestamp,
  thumbnail,
  image,
} = {}) {
  const normalizedTitle = title.startsWith("⚠️") ? title : `⚠️ ${title}`;
  return createDamoEmbed({
    title: normalizedTitle,
    description,
    color: EmbedColor.WARNING,
    fields,
    footerText,
    footerIconUrl,
    timestamp,
    thumbnail,
    image,
  });
}
