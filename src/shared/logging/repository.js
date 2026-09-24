/**
 * Shared Log Repository Utilities.
 * Common database helpers for audit tracking and pagination SQL building.
 */

let auditSeqCounter = 0;

/**
 * Generate a collision-resistant audit tracking ID.
 *
 * @param {string} [prefix="AUD"]
 * @returns {string} e.g. "AUD-1725482938123-0042"
 */
export function generateAuditId(prefix = "AUD") {
  auditSeqCounter = (auditSeqCounter + 1) % 10000;
  return `${prefix}-${Date.now()}-${String(auditSeqCounter).padStart(4, "0")}`;
}
