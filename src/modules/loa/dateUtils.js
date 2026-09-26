/**
 * Date and timezone utilities for Vital RP Staff LOA Manager.
 * All calendar date calculations strictly use America/Chicago timezone.
 */

export const TIMEZONE = "America/Chicago";

/**
 * Days in months (non-leap year).
 */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Check if a year is a leap year.
 * @param {number} year
 * @returns {boolean}
 */
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Get the number of days in a given month and year.
 * @param {number} month (1-12)
 * @param {number} year
 * @returns {number}
 */
export function getDaysInMonth(month, year) {
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return DAYS_IN_MONTH[month] || 0;
}

/**
 * Manually parse and validate a date string in various common formats:
 * - MM/DD/YYYY, M/D/YYYY, M/DD/YYYY, MM/D/YYYY (e.g. 9/1/2026, 09/01/2026, 9/01/2026, 09/1/2026)
 * - MM-DD-YYYY, M-D-YYYY, M-DD-YYYY, MM-D-YYYY (e.g. 9-1-2026, 09-01-2026)
 * - MM/DD/YY, M/D/YY, MM-DD-YY, M-D-YY (e.g. 9/1/26, 09/01/26)
 * - YYYY-MM-DD, YYYY/MM/DD, YYYY-M-D, YYYY/M/D (e.g. 2026-09-01)
 * - MM/DD, M/D, MM-DD, M-D (e.g. 9/1, 09/01 - year inferred from America/Chicago date)
 *
 * @param {string} dateStr - Raw user input
 * @param {string} [todayIso] - Reference date in America/Chicago (YYYY-MM-DD)
 * @returns {{ valid: boolean, error?: string, isoDate?: string, displayDate?: string }}
 */
export function parseAndValidateDate(dateStr, todayIso = getTodayInChicago()) {
  if (typeof dateStr !== "string") {
    return {
      valid: false,
      error: "Date must be a string.",
    };
  }

  const trimmed = dateStr.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: "Date cannot be empty.",
    };
  }

  // 0. Keyword format: "today" or "now"
  const lowerTrimmed = trimmed.toLowerCase();
  if (lowerTrimmed === "today" || lowerTrimmed === "now") {
    const refDate = todayIso || getTodayInChicago();
    return {
      valid: true,
      isoDate: refDate,
      displayDate: isoToDisplayDate(refDate),
    };
  }

  let year = null;
  let month = null;
  let day = null;

  // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    year = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10);
    day = parseInt(isoMatch[3], 10);
  }

  // 2. Month/Day/Year with 4-digit year: M/D/YYYY or M-D-YYYY
  if (year === null) {
    const fullYearMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
    if (fullYearMatch) {
      month = parseInt(fullYearMatch[1], 10);
      day = parseInt(fullYearMatch[2], 10);
      year = parseInt(fullYearMatch[3], 10);
    }
  }

  // 3. Month/Day/Year with 2-digit year: M/D/YY or M-D-YY
  if (year === null) {
    const shortYearMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(trimmed);
    if (shortYearMatch) {
      month = parseInt(shortYearMatch[1], 10);
      day = parseInt(shortYearMatch[2], 10);
      year = 2000 + parseInt(shortYearMatch[3], 10);
    }
  }

  // 4. Month/Day without year: M/D or M-D (inferred from America/Chicago)
  if (year === null) {
    const noYearMatch = /^(\d{1,2})[/-](\d{1,2})$/.exec(trimmed);
    if (noYearMatch) {
      month = parseInt(noYearMatch[1], 10);
      day = parseInt(noYearMatch[2], 10);

      const refDate = todayIso || getTodayInChicago();
      const curYear = parseInt(refDate.split("-")[0], 10) || new Date().getFullYear();

      year = curYear;
      const mmTest = String(month).padStart(2, "0");
      const ddTest = String(day).padStart(2, "0");
      const candidateIso = `${year}-${mmTest}-${ddTest}`;

      // If the date has already passed in the current year, use the next calendar year
      if (candidateIso < refDate) {
        year += 1;
      }
    }
  }

  // If no pattern matched
  if (year === null || month === null || day === null) {
    return {
      valid: false,
      error: "Please enter a valid date, for example: `9/5/2026`, `09/05/2026`, or `9/5`",
    };
  }

  // Validate year bounds
  if (year < 2000 || year > 2100) {
    return {
      valid: false,
      error: "Year must be between 2000 and 2100.",
    };
  }

  // Validate month bounds (1-12)
  if (month < 1 || month > 12) {
    return {
      valid: false,
      error: `Invalid month: ${month}. Month must be between 1 and 12.`,
    };
  }

  // Validate day bounds against days in month (including leap years)
  const maxDays = getDaysInMonth(month, year);
  if (day < 1 || day > maxDays) {
    return {
      valid: false,
      error: `Invalid date: Month ${month} in year ${year} only has ${maxDays} days.`,
    };
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const yyyy = String(year);

  return {
    valid: true,
    isoDate: `${yyyy}-${mm}-${dd}`,
    displayDate: `${mm}/${dd}/${yyyy}`,
  };
}

const MONTH_NAMES = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Format an ISO date (YYYY-MM-DD) to friendly format (e.g. Sep 1, 2026).
 * @param {string} isoDate
 * @returns {string}
 */
export function formatPrettyDate(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return "";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const [yyyy, mm, dd] = parts;
  const monthName = MONTH_NAMES[parseInt(mm, 10)] || mm;
  const day = parseInt(dd, 10);
  return `${monthName} ${day}, ${yyyy}`;
}

/**
 * Format a date range with full year on both dates (e.g. Sep 1, 2026 → Sep 8, 2026).
 * @param {string} startIso
 * @param {string} endIso
 * @returns {string}
 */
export function formatPrettyDateRange(startIso, endIso) {
  if (!startIso || !endIso) return "";
  return `${formatPrettyDate(startIso)} → ${formatPrettyDate(endIso)}`;
}

/**
 * Format a compact date range for list entries.
 * If both dates are in the same year: Sep 1 → Sep 8
 * If dates span different years: Sep 28, 2026 → Jan 5, 2027
 * @param {string} startIso
 * @param {string} endIso
 * @returns {string}
 */
export function formatCompactDateRange(startIso, endIso) {
  if (!startIso || !endIso) return "";
  const [sYear, sMm, sDd] = startIso.split("-");
  const [eYear, eMm, eDd] = endIso.split("-");
  const sMonth = MONTH_NAMES[parseInt(sMm, 10)] || sMm;
  const eMonth = MONTH_NAMES[parseInt(eMm, 10)] || eMm;
  const sDay = parseInt(sDd, 10);
  const eDay = parseInt(eDd, 10);

  if (sYear === eYear) {
    return `${sMonth} ${sDay} → ${eMonth} ${eDay}`;
  }
  return `${sMonth} ${sDay}, ${sYear} → ${eMonth} ${eDay}, ${eYear}`;
}

/**
 * Format an ISO date (YYYY-MM-DD) to display format (MM/DD/YYYY).
 * @param {string} isoDate
 * @returns {string}
 */
export function isoToDisplayDate(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return "";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const [yyyy, mm, dd] = parts;
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Get the current calendar date in America/Chicago formatted as YYYY-MM-DD.
 * @param {Date} [date=new Date()]
 * @returns {string} ISO date string (YYYY-MM-DD)
 */
export function getTodayInChicago(date = null) {
  if (!date && process.env.NODE_ENV === "test" && process.env.TEST_TODAY_CHICAGO) {
    return process.env.TEST_TODAY_CHICAGO;
  }
  const targetDate = date || new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(targetDate);
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  const year = parts.find((p) => p.type === "year")?.value;

  return `${year}-${month}-${day}`;
}

/**
 * Convert an ISO date string (YYYY-MM-DD) to a Unix timestamp in seconds for Discord formatting.
 * Defaults to America/Chicago noon (17:00 UTC).
 *
 * @param {string} isoDate - YYYY-MM-DD
 * @param {Object} [options]
 * @param {"start"|"noon"|"end"} [options.timeOfDay="noon"]
 * @returns {number} Unix timestamp in seconds
 */
export function isoToDiscordTimestamp(isoDate, { timeOfDay = "noon" } = {}) {
  if (!isoDate || typeof isoDate !== "string") {
    return Math.floor(Date.now() / 1000);
  }
  const parts = isoDate.split("-");
  if (parts.length !== 3) {
    return Math.floor(Date.now() / 1000);
  }
  const [yyyy, mm, dd] = parts.map((p) => parseInt(p, 10));
  let hours = 12;
  if (timeOfDay === "start") hours = 0;
  if (timeOfDay === "end") hours = 23;
  // America/Chicago CDT is UTC-5, CST is UTC-6. Using 17:00 UTC corresponds to noon/daytime.
  const utcHours = hours + 5;
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, utcHours, 0, 0));
  return Math.floor(d.getTime() / 1000);
}

/**
 * Format a Discord timestamp string (e.g. <t:1700000000:D> or <t:1700000000:R>).
 *
 * @param {string} isoDate - YYYY-MM-DD
 * @param {string} [style="D"] - "D" (date), "R" (relative), "F" (full)
 * @param {Object} [options]
 * @returns {string} Discord timestamp tag
 */
export function formatDiscordTimestamp(isoDate, style = "D", options = {}) {
  const ts = isoToDiscordTimestamp(isoDate, options);
  return `<t:${ts}:${style}>`;
}

/**
 * Determine LOA status dynamically based on current Chicago date and record fields.
 *
 * @param {Object} loa
 * @param {string} loa.start_date - YYYY-MM-DD
 * @param {string} loa.end_date - YYYY-MM-DD
 * @param {number|boolean} loa.cancelled
 * @param {number|boolean} loa.ended_early
 * @param {string|null} loa.ended_at
 * @param {string} [todayIso] - Current date in America/Chicago (YYYY-MM-DD)
 * @returns {{ code: string, label: string }}
 */
export function getLoaStatus(loa, todayIso = getTodayInChicago()) {
  if (loa.cancelled) {
    return { code: "CANCELLED", label: "⚪ Cancelled" };
  }
  if (loa.ended_early || loa.return_type === "EARLY_RETURN") {
    return { code: "ENDED_EARLY", label: "⚪ Returned Early" };
  }
  if (loa.ended_at || loa.role_restore_status === "completed") {
    return { code: "COMPLETED", label: "🔵 Completed" };
  }
  if (todayIso < loa.start_date) {
    return { code: "UPCOMING", label: "🟡 Upcoming" };
  }
  if (todayIso >= loa.start_date && todayIso <= loa.end_date) {
    return { code: "ACTIVE", label: "🟢 Active" };
  }
  // If todayIso > loa.end_date and the LOA was active/swapped and not completed, it is OVERDUE
  if (
    (loa.status === "active" ||
      loa.is_active === 1 ||
      loa.role_swap_status === "completed" ||
      loa.overdue) &&
    !loa.ended_at &&
    !loa.cancelled &&
    !loa.ended_early
  ) {
    return { code: "OVERDUE", label: "🔴 OVERDUE" };
  }
  return { code: "COMPLETED", label: "🔵 Completed" };
}

