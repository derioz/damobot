/**
 * Shared Logging Utilities.
 * Common formatters and string helpers for log records (Punishments, OOC Jail Logs, Refunds).
 */

/**
 * Format an ISO date string or Date to a human-readable string: "Sep 4, 2026, 4:52 PM".
 * Uses America/Chicago timezone for consistent Vital RP server time.
 *
 * @param {string|Date} dateInput
 * @returns {string}
 */
export function formatLogDate(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "Unknown Date";

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const parts = formatter.formatToParts(d);
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    const year = parts.find((p) => p.type === "year")?.value;
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value || "").toUpperCase();

    if (month && day && year && hour && minute && dayPeriod) {
      return `${month} ${day}, ${year}, ${hour}:${minute} ${dayPeriod}`;
    }

    return formatter.format(d);
  } catch {
    return "Unknown Date";
  }
}

/**
 * Checks if a string is a valid HTTP/HTTPS or Discord URL.
 *
 * @param {string} str
 * @returns {boolean}
 */
export function isValidUrl(str) {
  if (!str || typeof str !== "string") return false;
  const trimmed = str.trim();
  try {
    const u = new URL(trimmed);
    return (
      u.protocol === "http:" ||
      u.protocol === "https:" ||
      u.protocol === "discord:"
    );
  } catch {
    return false;
  }
}

/**
 * Normalizes a web or reference URL.
 * Prepends "https://" if it matches a domain pattern without a protocol.
 *
 * @param {string} str
 * @returns {string} Normalized URL
 */
export function normalizeUrl(str) {
  if (!str || typeof str !== "string") return "";
  const trimmed = str.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * Check if a raw Discord ID string represents a valid Discord snowflake ID.
 *
 * @param {string} rawId
 * @returns {boolean}
 */
export function isValidDiscordId(rawId) {
  if (!rawId || typeof rawId !== "string") return false;
  const trimmed = rawId.trim();
  return /^\d{17,20}$/.test(trimmed);
}

/**
 * Format player name and optional Discord ID into standard Discord markdown.
 *
 * @param {string} playerName
 * @param {string} [playerDiscordId]
 * @returns {string} e.g. "**John Doe** • `150580708144840704`"
 */
export function formatPlayerLine(playerName, playerDiscordId) {
  const name = playerName || "Unknown";
  const rawId = (playerDiscordId || "").trim();
  const hasValidId = rawId && rawId !== "N/A" && rawId !== "None" && rawId !== "0";

  return hasValidId ? `**${name}** • \`${rawId}\`` : `**${name}**`;
}

/**
 * Format multi-line text into Discord markdown blockquotes.
 *
 * @param {string} text
 * @param {string} [fallback="No reason provided."]
 * @returns {string}
 */
export function formatBlockquote(text, fallback = "No reason provided.") {
  const content = (text || fallback).trim();
  return content
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}
