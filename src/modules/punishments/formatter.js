import {
  ComponentType,
  ButtonStyle,
  PunishmentCustomId,
} from "./constants.js";

/**
 * Format an ISO date string to a human-readable string: "Sep 3, 2026 • 4:52 PM".
 * Uses America/Chicago timezone for consistent Vital RP server time.
 *
 * @param {string|Date} dateInput
 * @returns {string}
 */
export function formatPunishmentDate(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "Unknown Date";

    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

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
 * Checks if a string is a valid HTTP/HTTPS URL.
 * @param {string} str
 * @returns {boolean}
 */
export function isValidUrl(str) {
  if (!str || typeof str !== "string") return false;
  const trimmed = str.trim();
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Format the standard, searchable Discord text message content for a punishment log.
 *
 * CRITICAL SEARCHABILITY REQUIREMENT:
 * This output is placed directly in the message `content` markdown field.
 * All critical fields (Player Name, Discord ID, Punishment ID, Punishment, Length, Reason, Staff Name, Staff ID)
 * are plain text in the message body so standard Discord Search indexes them completely.
 *
 * @param {Object} record
 * @param {string} record.punishmentId e.g. "VRP-P-000142"
 * @param {string} record.playerName e.g. "Yamsheed Yaffari"
 * @param {string} [record.playerDiscordId] e.g. "333552471588864013"
 * @param {string} record.punishment e.g. "VDM"
 * @param {string} [record.punishmentLength] e.g. "2 Days"
 * @param {string} record.reason e.g. "DM with context..."
 * @param {string} [record.additionalInfo] e.g. "Black market scene, immediate action taken."
 * @param {string} [record.reportUrl]
 * @param {string} [record.responseUrl]
 * @param {string} [record.evidenceImageUrl]
 * @param {string} record.staffName e.g. "Big-Croissant-Chungus"
 * @param {string} record.staffDiscordId e.g. "150580708144840704"
 * @param {string|Date} [record.createdAt]
 * @returns {string} Standard Discord message content
 */
export function formatPunishmentLog(record) {
  const pId = record.punishmentId || "VRP-P-000000";
  const name = record.playerName || "Unknown";
  const rawDiscordId = (record.playerDiscordId || "").trim();
  const hasValidDiscordId = rawDiscordId && rawDiscordId !== "N/A" && rawDiscordId !== "None";
  const playerLine = hasValidDiscordId
    ? `**${name}** • \`${rawDiscordId}\``
    : `**${name}**`;
  const punishment = record.punishment || "Warning";
  const reason = (record.reason || "No reason provided.").trim();
  const staffName = record.staffName || "Staff";
  const staffId = (record.staffDiscordId || "").trim();
  const hasStaffId = staffId && staffId !== "0" && staffId !== "N/A";
  const dateStr = formatPunishmentDate(record.createdAt || new Date());

  const lines = [
    `⚖️ **Punishment Logged** • \`${pId}\``,
    "",
    playerLine,
    `**Punishment:** ${punishment}`,
  ];

  if (record.punishmentLength && record.punishmentLength.trim()) {
    lines.push(`**Length:** ${record.punishmentLength.trim()}`);
  }

  lines.push("");

  // Reason in blockquote
  const quoteReason = reason
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
  lines.push(quoteReason);

  if (record.additionalInfo && record.additionalInfo.trim()) {
    lines.push("");
    lines.push(`**Additional Info:** ${record.additionalInfo.trim()}`);
  }

  const hasReport = Boolean(record.reportUrl && record.reportUrl.trim());
  const hasResponse = Boolean(record.responseUrl && record.responseUrl.trim());

  if (hasReport || hasResponse) {
    lines.push("");
    if (hasReport) {
      lines.push(`**Report:** ${record.reportUrl.trim()}`);
    }
    if (hasResponse) {
      lines.push(`**Response:** ${record.responseUrl.trim()}`);
    }
  }

  lines.push("");
  lines.push(`-# Logged by **${staffName}** • ${dateStr}`);
  if (hasStaffId) {
    lines.push(`-# Staff ID: \`${staffId}\``);
  }

  return lines.join("\n");
}

/**
 * Build standard Action Row components placed beneath the searchable Discord punishment log.
 * Contains:
 * - [ 📋 Report ] link button (if reportUrl is a valid URL)
 * - [ 💬 Response ] link button (if responseUrl is a valid URL)
 * - [ 🖼️ Evidence ] link button (if evidenceImageUrl is a valid URL)
 * - [ 👤 Player History ] button (triggers ephemeral lookup)
 *
 * @param {Object} record
 * @returns {Array<Object>} Array with 1 Action Row
 */
export function createPunishmentActionRow(record) {
  const buttons = [];

  // 1. Report Link button if valid URL
  if (record.reportUrl && isValidUrl(record.reportUrl)) {
    buttons.push({
      type: ComponentType.BUTTON,
      style: ButtonStyle.LINK,
      url: record.reportUrl.trim(),
      label: "Report",
      emoji: { name: "📋" },
    });
  }

  // 2. Response Link button if valid URL
  if (record.responseUrl && isValidUrl(record.responseUrl)) {
    buttons.push({
      type: ComponentType.BUTTON,
      style: ButtonStyle.LINK,
      url: record.responseUrl.trim(),
      label: "Response",
      emoji: { name: "💬" },
    });
  }

  // 3. Evidence Link button if valid URL
  if (record.evidenceImageUrl && isValidUrl(record.evidenceImageUrl)) {
    buttons.push({
      type: ComponentType.BUTTON,
      style: ButtonStyle.LINK,
      url: record.evidenceImageUrl.trim(),
      label: "Evidence",
      emoji: { name: "🖼️" },
    });
  }

  // 4. Player History button
  const lookupKey = (record.playerDiscordId && record.playerDiscordId !== "N/A")
    ? record.playerDiscordId
    : record.playerName;

  buttons.push({
    type: ComponentType.BUTTON,
    custom_id: `${PunishmentCustomId.BTN_PLAYER_HISTORY_PREFIX}${lookupKey}`,
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

/**
 * Format message embeds for optional media attachments (e.g. Evidence Image).
 * Renders the image directly inline beneath the searchable text in Discord.
 *
 * @param {Object} record
 * @returns {Array<Object>} Array of Discord Embed objects
 */
export function formatPunishmentEmbeds(record) {
  if (record.evidenceImageUrl && isValidUrl(record.evidenceImageUrl)) {
    return [
      {
        image: {
          url: record.evidenceImageUrl.trim(),
        },
      },
    ];
  }
  return [];
}
