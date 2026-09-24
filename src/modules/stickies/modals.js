/**
 * Sticky Message Modal Builders
 */

/**
 * Build Discord modal payload for creating or editing a sticky message.
 * Uses a Paragraph-style text input (style: 2) supporting full multi-line
 * formatting, markdown headers, bold/italic, lists, blockquotes, blank lines,
 * emojis, and mentions up to Discord's 2000-character limit.
 *
 * @param {Object} options
 * @param {string} options.channelId
 * @param {string} [options.buttonAction="none"]
 * @param {string} [options.existingText=""]
 * @param {boolean} [options.isEdit=false]
 * @returns {Object} Discord Modal payload
 */
export function buildStickyModal({
  channelId,
  buttonAction = "none",
  existingText = "",
  isEdit = false,
}) {
  const safeButton = buttonAction && buttonAction !== "none" ? buttonAction : "none";
  const customId = isEdit
    ? `sticky_modal_edit:${channelId}:${safeButton}`
    : `sticky_modal_create:${channelId}:${safeButton}`;

  return {
    title: isEdit ? "Edit Sticky Message" : "Create Sticky Message",
    custom_id: customId,
    components: [
      {
        type: 1, // ACTION_ROW
        components: [
          {
            type: 4, // TEXT_INPUT
            custom_id: "sticky_content",
            label: "Sticky Message Content",
            style: 2, // Paragraph
            required: true,
            placeholder: "Enter sticky message with Markdown, headers (#), bold (**), quotes (>), mentions (<#id>, <@id>)...",
            max_length: 2000,
            value: existingText || "",
          },
        ],
      },
    ],
  };
}
