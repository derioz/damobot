/**
 * Backward compatibility facade for referral sheet operations.
 * Centralized Google Sheets OAuth services are located in src/shared/googleSheets.js.
 * Referral-specific submission logic is located in src/modules/referrals/sheets.js.
 */

export * from "./modules/referrals/sheets.js";
