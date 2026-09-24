import {
  ComponentType,
  ButtonStyle,
  RefundCustomId,
  buildRefundPlayerHistoryCustomId,
  getRefundCategoryConfig,
} from "./constants.js";

/**
 * Format an ISO date string or Date to a human-readable string: "Sep 4, 2026, 4:52 PM".
 * Uses America/Chicago timezone for consistent Vital RP server time.
 *
 * @param {string|Date} dateInput
 * @returns {string}
 */
export function formatRefundDate(dateInput) {
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
 * Normalizes a ticket or reference URL.
 * If a user provides a web link without protocol (e.g. "discord.com/channels/..." or "tickettool.xyz/..."),
 * prepends "https://" if it matches a domain pattern.
 *
 * @param {string} str
 * @returns {string} Normalized URL or trimmed string
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
 * Format the standard, searchable Discord text message content for a refund log.
 *
 * CRITICAL SEARCHABILITY REQUIREMENT:
 * This output is placed directly in the message `content` markdown field.
 * All critical fields (Player Name, Discord ID, Refund ID, Category, Details, Reason, Staff Name, Staff ID)
 * are plain text in the message body so standard Discord Search indexes them completely.
 *
 * @param {Object} record
 * @param {string} record.refundId e.g. "VRP-R-000001"
 * @param {string} record.playerName e.g. "John Doe"
 * @param {string} [record.playerDiscordId] e.g. "150580708144840704"
 * @param {string} record.refundCategory e.g. "Vitcoin"
 * @param {string} record.refundDetails e.g. "50,000 Vitcoins"
 * @param {string} record.reason e.g. "Accidental double charge on vehicle purchase"
 * @param {string} [record.ticketUrl] e.g. "https://tickettool.xyz/..."
 * @param {string} record.staffName e.g. "Damo"
 * @param {string} record.staffDiscordId e.g. "123456789012345678"
 * @param {string|Date} [record.createdAt]
 * @returns {string} Standard Discord message content
 */
export function formatRefundLog(record) {
  const rId = record.refundId || "VRP-R-000000";
  const name = record.playerName || "Unknown";
  const rawDiscordId = (record.playerDiscordId || "").trim();
  const hasValidDiscordId = rawDiscordId && rawDiscordId !== "N/A" && rawDiscordId !== "None";
  const playerLine = hasValidDiscordId
    ? `**${name}** • \`${rawDiscordId}\``
    : `**${name}**`;
  const catConfig = getRefundCategoryConfig(record.refundCategory);
  const category =
    catConfig.logLabel || catConfig.label || record.refundCategory || "Other";
  const details = record.refundDetails || "No details provided.";
  const reason = (record.reason || "No reason provided.").trim();
  const staffName = record.staffName || "Staff";
  const staffId = (record.staffDiscordId || "").trim();
  const hasStaffId = staffId && staffId !== "0" && staffId !== "N/A";
  const dateStr = formatRefundDate(record.createdAt || new Date());

  const lines = [
    `💰 **Refund Logged** • \`${rId}\``,
    "",
    playerLine,
    `**Category:** ${category}`,
    `**Details:** ${details}`,
    "",
  ];

  // Reason in blockquote
  const quoteReason = reason
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
  lines.push(quoteReason);

  const ticketUrl = normalizeUrl(record.ticketUrl);
  if (ticketUrl) {
    lines.push("");
    lines.push(`**Ticket:** ${ticketUrl}`);
  }

  lines.push("");
  lines.push(`-# Logged by **${staffName}** • ${dateStr}`);
  if (hasStaffId) {
    lines.push(`-# Staff ID: \`${staffId}\``);
  }

  return lines.join("\n");
}

/**
 * Build standard Action Row components placed beneath the searchable Discord refund log.
 * Contains:
 * - [ 🎫 Ticket ] link button (if ticketUrl is a valid URL)
 * - [ 👤 Player History ] button (triggers ephemeral lookup)
 *
 * @param {Object} record
 * @returns {Array<Object>} Array with 1 Action Row
 */
export function createRefundActionRow(record) {
  const buttons = [];

  // 1. Ticket Link button if valid URL
  const ticketUrl = normalizeUrl(record.ticketUrl);
  if (ticketUrl && isValidUrl(ticketUrl)) {
    buttons.push({
      type: ComponentType.BUTTON,
      style: ButtonStyle.LINK,
      url: ticketUrl,
      label: "Ticket",
      emoji: { name: "🎫" },
    });
  }

  // 2. Edit Record button
  if (record.refundId) {
    buttons.push({
      type: ComponentType.BUTTON,
      custom_id: `${RefundCustomId.BTN_EDIT_PREFIX}${record.refundId}`,
      label: "Edit Record",
      style: ButtonStyle.SECONDARY,
      emoji: { name: "✏️" },
    });
  }

  // 3. Player History button
  buttons.push({
    type: ComponentType.BUTTON,
    custom_id: buildRefundPlayerHistoryCustomId(record.refundId),
    label: "Player History",
    style: ButtonStyle.SECONDARY,
    emoji: { name: "👤" },
  });

  return [
    {
      type: ComponentType.ACTION_ROW,
      components: buttons,
    },
  ];
}
