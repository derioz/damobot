/**
 * Ticket Reminder Time & Duration Utilities.
 */

/**
 * Parse a human duration string (e.g. '30m', '1h', '24h', '2d', '7d') into milliseconds.
 *
 * @param {string} input Duration string
 * @returns {{ durationMs: number, amount: number, unit: string }|null}
 */
export function parseReminderDuration(input) {
  if (!input || typeof input !== "string") return null;

  const cleaned = input.trim();
  const match = cleaned.match(/^(\d+)\s*([a-zA-Z]+)$/);
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  if (isNaN(amount) || amount <= 0) return null;

  const unit = match[2].toLowerCase();
  let msMultiplier = 0;

  switch (unit) {
    case "m":
    case "min":
    case "mins":
    case "minute":
    case "minutes":
      msMultiplier = 60 * 1000;
      break;
    case "h":
    case "hr":
    case "hrs":
    case "hour":
    case "hours":
      msMultiplier = 60 * 60 * 1000;
      break;
    case "d":
    case "day":
    case "days":
      msMultiplier = 24 * 60 * 60 * 1000;
      break;
    case "w":
    case "wk":
    case "wks":
    case "week":
    case "weeks":
      msMultiplier = 7 * 24 * 60 * 60 * 1000;
      break;
    default:
      return null;
  }

  const durationMs = amount * msMultiplier;

  // Safe bounds: minimum 1 minute, maximum 30 days
  const MIN_MS = 60 * 1000;
  const MAX_MS = 30 * 24 * 60 * 60 * 1000;

  if (durationMs < MIN_MS || durationMs > MAX_MS) {
    return null;
  }

  return {
    durationMs,
    amount,
    unit,
  };
}

/**
 * Format a Date or ISO string into a Discord relative timestamp: <t:UNIX:R>
 *
 * @param {Date|string} dateInput
 * @returns {string}
 */
export function formatDiscordRelativeTime(dateInput) {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const unix = Math.floor(d.getTime() / 1000);
  return `<t:${unix}:R>`;
}

/**
 * Format a Date or ISO string into a Discord full date timestamp: <t:UNIX:f>
 *
 * @param {Date|string} dateInput
 * @returns {string}
 */
export function formatDiscordFullTime(dateInput) {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const unix = Math.floor(d.getTime() / 1000);
  return `<t:${unix}:f>`;
}
