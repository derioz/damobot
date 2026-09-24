/**
 * Shared Search Utilities for Log Modules.
 */

import { isValidDiscordId } from "./utilities.js";

/**
 * Tokenize a search query into normalized lowercase terms.
 *
 * @param {string} query
 * @returns {Array<string>}
 */
export function tokenizeSearchQuery(query) {
  if (!query || typeof query !== "string") return [];
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Check if a search query is specifically a Discord Snowflake ID.
 *
 * @param {string} query
 * @returns {boolean}
 */
export function isDiscordIdQuery(query) {
  if (!query || typeof query !== "string") return false;
  return isValidDiscordId(query.trim());
}

/**
 * Match an object record against search tokens across specified string fields.
 *
 * @param {Object} record
 * @param {Array<string>} tokens
 * @param {Array<string>} fieldNames
 * @returns {boolean}
 */
export function matchesSearchTokens(record, tokens = [], fieldNames = []) {
  if (!record || tokens.length === 0) return true;

  const combined = fieldNames
    .map((f) => (record[f] ? String(record[f]).toLowerCase() : ""))
    .join(" ");

  return tokens.every((token) => combined.includes(token));
}
