import { ButtonStyle } from "./constants.js";

/**
 * Safely extracts a direct TicketTool transcript URL from a Discord message.
 *
 * Inspects the message safely in order of reliability:
 * 1. Component Link Buttons:
 *    - Link button (style 5) where the URL contains 'tickettool.xyz' or 'ticket-tool', OR
 *    - Link button whose label includes 'transcript' (case-insensitive) pointing to http(s) URL.
 * 2. Message Attachments:
 *    - Attachment where filename or URL explicitly includes 'transcript' (e.g. transcript-ticket-123.html).
 * 3. Message Embeds:
 *    - Embed URL containing 'tickettool.xyz' or 'transcript'.
 *    - Markdown transcript links in embed description or fields: e.g. [Direct Transcript](https://...).
 *    - Direct 'tickettool.xyz' URLs in embed description or fields.
 * 4. Message Content:
 *    - Direct 'tickettool.xyz' URLs in plain text content.
 * 5. Fallback:
 *    - Returns fallbackJumpUrl if no reliable direct transcript URL can be identified.
 *
 * Does NOT scrape arbitrary URLs blindly.
 * Does NOT guess what a URL represents.
 *
 * @param {Object} message - Discord message object
 * @param {string} [fallbackJumpUrl=""] - Fallback Discord message jump URL
 * @returns {string} Identified transcript URL or fallback
 */
export function extractTicketTranscriptUrl(message, fallbackJumpUrl = "") {
  if (!message || typeof message !== "object") {
    return fallbackJumpUrl;
  }

  // 1. Inspect Components (Action Rows and Buttons)
  if (Array.isArray(message.components)) {
    for (const row of message.components) {
      if (Array.isArray(row.components)) {
        for (const comp of row.components) {
          const isLink =
            comp.type === 2 &&
            (comp.style === 5 || comp.style === ButtonStyle.LINK);

          if (isLink && comp.url && typeof comp.url === "string") {
            const url = comp.url.trim();
            const label = (comp.label || "").toLowerCase();
            const isTicketToolDomain =
              /tickettool\.xyz/i.test(url) || /ticket-tool/i.test(url);
            const isTranscriptLabel = label.includes("transcript");
            const isTranscriptUrl = /transcript/i.test(url);

            if (isTicketToolDomain || (isTranscriptLabel && isTranscriptUrl)) {
              return url;
            }
            if (isTranscriptLabel && /^https?:\/\//i.test(url)) {
              return url;
            }
          }
        }
      }
    }
  }

  // 2. Inspect Attachments
  if (Array.isArray(message.attachments)) {
    for (const att of message.attachments) {
      if (att && att.url && typeof att.url === "string") {
        const filename = (att.filename || "").toLowerCase();
        const attUrl = att.url.toLowerCase();
        if (filename.includes("transcript") || attUrl.includes("transcript")) {
          return att.url;
        }
      }
    }
  }

  // 3. Inspect Embeds
  if (Array.isArray(message.embeds)) {
    for (const embed of message.embeds) {
      if (!embed) continue;

      if (embed.url && isTicketToolUrl(embed.url)) {
        return embed.url;
      }

      if (embed.description && typeof embed.description === "string") {
        const found = findTranscriptUrlInText(embed.description);
        if (found) return found;
      }

      if (Array.isArray(embed.fields)) {
        for (const field of embed.fields) {
          if (field?.value && typeof field.value === "string") {
            const found = findTranscriptUrlInText(field.value);
            if (found) return found;
          }
        }
      }
    }
  }

  // 4. Inspect Content
  if (message.content && typeof message.content === "string") {
    const found = findTranscriptUrlInText(message.content);
    if (found) return found;
  }

  // 5. Fallback
  return fallbackJumpUrl;
}

function isTicketToolUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /tickettool\.xyz/i.test(url);
}

function findTranscriptUrlInText(text) {
  // 1. Markdown link containing transcript in the label: [Direct Transcript](https://...)
  const mdMatch = text.match(
    /\[([^\]]*transcript[^\]]*)\]\((https?:\/\/[^\s\)]+)\)/i
  );
  if (mdMatch && mdMatch[2]) {
    return mdMatch[2];
  }

  // 2. Direct tickettool.xyz URL
  const ttMatch = text.match(/(https?:\/\/(?:www\.)?tickettool\.xyz[^\s\)>]+)/i);
  if (ttMatch && ttMatch[1]) {
    return ttMatch[1];
  }

  return null;
}

/**
 * Computes a deterministic compact 32-bit hex hash (FNV-1a) of a string.
 * Used for detecting stale confirmation cards without exceeding Discord's 100-character custom_id limit.
 *
 * @param {string} str - String to hash
 * @returns {string} Hex hash string
 */
export function hashString(str) {
  if (!str || typeof str !== "string") return "0";
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
