/**
 * Ticket Reminder System Constants & Defaults.
 */

import {
  DEFAULT_SUPPORT_ROLE_ID,
  DEFAULT_MODERATOR_ROLE_ID,
} from "../../config/roles.js";

// Vital RP Support Chat Channel ID
export const DEFAULT_TICKET_REMINDER_CHANNEL_ID = "1220039518279827528";

export { DEFAULT_SUPPORT_ROLE_ID, DEFAULT_MODERATOR_ROLE_ID };

export const ReminderType = {
  PERSONAL: "personal",
  STAFF: "staff",
};

export const ReminderStatus = {
  PENDING: "pending",
  SENDING: "sending",
  SENT: "sent",
  CANCELLED: "cancelled",
};

export const ReminderCustomId = {
  BTN_CANCEL_PREFIX: "remind_cancel:",
};

export const DEFAULT_PERSONAL_REMINDER_MESSAGE =
  "Check on this ticket and close it if appropriate.";

export const DEFAULT_GENERIC_REMINDER_MESSAGE =
  "Please check on this ticket and close it if no further action is needed.";

/**
 * Master feature flag for Ticket Reminders.
 * Set to false to safely disable all reminder interactions and cron deliveries.
 */
export const REMINDERS_ENABLED = false;

/**
 * Check if the ticket reminder system is currently enabled.
 * Defaults to false (disabled). Can be overridden via env.REMINDERS_ENABLED.
 *
 * @param {Object} [env]
 * @returns {boolean}
 */
export function isRemindersEnabled(env = {}) {
  if (env?.REMINDERS_ENABLED === "true" || env?.REMINDERS_ENABLED === true) {
    return true;
  }
  if (env?.REMINDERS_ENABLED === "false" || env?.REMINDERS_ENABLED === false) {
    return false;
  }
  return REMINDERS_ENABLED;
}
