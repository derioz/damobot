/**
 * Shared Discord Components V2 Layout Builders.
 * Standardizes Containers, Sections, TextDisplays, Thumbnails, Separators, and Footers.
 */

import { ComponentType } from "../discord.js";
import {
  DAMO_BOT_VERSION,
  VITAL_RP_LOGO_URL,
  VITAL_ORANGE,
} from "../../config/brand.js";

/**
 * Build a Components V2 Container (Type 17).
 *
 * @param {Array<Object>} components Children components inside the container
 * @param {number} [accentColor=VITAL_ORANGE] Accent border color
 * @returns {Object}
 */
export function createContainer(components = [], accentColor = VITAL_ORANGE) {
  return {
    type: ComponentType.CONTAINER,
    accent_color: accentColor,
    components: Array.isArray(components) ? components : [components],
  };
}

/**
 * Build a Section (Type 9).
 *
 * @param {Array<Object>} components Component children (e.g. TextDisplay)
 * @param {Object} [accessory=null] Optional accessory (e.g. Thumbnail or Button)
 * @returns {Object}
 */
export function createSection(components = [], accessory = null) {
  const section = {
    type: ComponentType.SECTION,
    components: Array.isArray(components) ? components : [components],
  };
  if (accessory) {
    section.accessory = accessory;
  }
  return section;
}

/**
 * Build a TextDisplay component (Type 10).
 *
 * @param {string} content Markdown or plain text content
 * @returns {Object}
 */
export function createTextDisplay(content = "") {
  return {
    type: ComponentType.TEXT_DISPLAY,
    content: String(content),
  };
}

/**
 * Build a Thumbnail accessory (Type 11).
 *
 * @param {string} url Image URL
 * @param {string} [description="Thumbnail"] Accessible description
 * @returns {Object}
 */
export function createThumbnail(url, description = "Thumbnail") {
  return {
    type: ComponentType.THUMBNAIL,
    media: {
      url,
      description,
    },
  };
}

/**
 * Build a Separator component (Type 14).
 *
 * @param {number} [spacing=1] Spacing size (1 = small, 2 = large)
 * @param {boolean} [divider=true] Whether to draw a visible divider line
 * @returns {Object}
 */
export function createSeparator(spacing = 1, divider = true) {
  return {
    type: ComponentType.SEPARATOR,
    spacing,
    divider,
  };
}

/**
 * Build a String Select Menu (Type 3).
 *
 * @param {Object} options
 * @param {string} options.customId
 * @param {Array<Object>} options.options
 * @param {string} [options.placeholder]
 * @param {number} [options.minValues=1]
 * @param {number} [options.maxValues=1]
 * @returns {Object}
 */
export function createStringSelect({
  customId,
  options = [],
  placeholder,
  minValues = 1,
  maxValues = 1,
} = {}) {
  const select = {
    type: ComponentType.STRING_SELECT,
    custom_id: customId,
    options,
    min_values: minValues,
    max_values: maxValues,
  };
  if (placeholder) select.placeholder = placeholder;
  return select;
}

/**
 * Build a User Select Menu (Type 5).
 *
 * @param {Object} options
 * @param {string} options.customId
 * @param {string} [options.placeholder]
 * @param {number} [options.minValues=1]
 * @param {number} [options.maxValues=1]
 * @returns {Object}
 */
export function createUserSelect({
  customId,
  placeholder,
  minValues = 1,
  maxValues = 1,
} = {}) {
  const select = {
    type: ComponentType.USER_SELECT,
    custom_id: customId,
    min_values: minValues,
    max_values: maxValues,
  };
  if (placeholder) select.placeholder = placeholder;
  return select;
}

/**
 * Standardized Damo-Bot footer Section with Vital RP branding and version.
 *
 * @param {string} [noteText=""] Optional extra note preceding the version
 * @returns {Object} Section component
 */
export function buildDamoFooter(noteText = "") {
  const prefix = noteText ? `${noteText} • ` : "";
  return createSection(
    [
      createTextDisplay(
        `-# ${prefix}Damo-Bot ${DAMO_BOT_VERSION} • Vital Roleplay`
      ),
    ],
    createThumbnail(VITAL_RP_LOGO_URL, "Vital RP")
  );
}
