/**
 * Durable Object for storing persistent sticky message configuration
 * and executing scheduled polling via Discord REST API.
 * Uses SQLite-backed Durable Object storage on Cloudflare Workers.
 */
import { buildSuggestionCenterSticky } from "../suggestions/components.js";

export class StickyBotDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    // In-memory fallback if sql is not available in mock/test environments
    this.memoryConfigs = new Map();

    this.initDatabase();
  }

  /**
   * Initialize SQLite tables.
   */
  initDatabase() {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS sticky_configs (
          channel_id TEXT PRIMARY KEY,
          guild_id TEXT,
          message_text TEXT NOT NULL,
          current_message_id TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL,
          button_action TEXT,
          button_label TEXT,
          button_style INTEGER,
          button_emoji TEXT
        );
      `);

      // Safely upgrade existing tables if columns do not exist yet
      const columns = [
        "button_action TEXT",
        "button_label TEXT",
        "button_style INTEGER",
        "button_emoji TEXT",
        "embed_data TEXT",
      ];
      for (const col of columns) {
        try {
          this.ctx.storage.sql.exec(`ALTER TABLE sticky_configs ADD COLUMN ${col};`);
        } catch {
          // Column already exists, safe to ignore
        }
      }
    }
  }

  /**
   * Build Discord message components (buttons) for a sticky message.
   * Returns null if no button is configured.
   *
   * @param {Object} config
   * @returns {Array<Object>|null} ActionRow components array or null
   */
  buildStickyComponents(config) {
    if (!config) return null;
    const action = config.button_action;
    if (!action || action === "none") {
      return null;
    }

    if (action === "punishment_center") {
      return [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 2, // BUTTON
              style: config.button_style || 2, // SECONDARY
              label: config.button_label || "Open Punishment Center",
              emoji: config.button_emoji ? { name: config.button_emoji } : { name: "⚖️" },
              custom_id: "sticky:punishment_center",
            },
          ],
        },
      ];
    }

    if (action === "refund_center") {
      return [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 2, // BUTTON
              style: config.button_style || 2, // SECONDARY
              label: config.button_label || "Open Refund Center",
              emoji: config.button_emoji ? { name: config.button_emoji } : { name: "💰" },
              custom_id: "sticky:refund_center",
            },
          ],
        },
      ];
    }

    if (action === "suggestions_submit") {
      return [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 2, // BUTTON
              style: config.button_style || 1, // PRIMARY
              label: config.button_label || "Submit Suggestion",
              emoji: config.button_emoji ? { name: config.button_emoji } : { name: "💡" },
              custom_id: "suggestions_submit",
            },
          ],
        },
      ];
    }

    if (action === "both") {
      return [
        {
          type: 1, // ACTION_ROW
          components: [
            {
              type: 2, // BUTTON
              style: 2, // SECONDARY
              label: "Punishment Center",
              emoji: { name: "🛡️" },
              custom_id: "sticky:punishment_center",
            },
            {
              type: 2, // BUTTON
              style: 2, // SECONDARY
              label: "Refund Center",
              emoji: { name: "💰" },
              custom_id: "sticky:refund_center",
            },
          ],
        },
      ];
    }

    // Generic button support
    return [
      {
        type: 1, // ACTION_ROW
        components: [
          {
            type: 2, // BUTTON
            style: config.button_style || 2,
            label: config.button_label || "Action",
            ...(config.button_emoji ? { emoji: { name: config.button_emoji } } : {}),
            custom_id: `sticky:${action}`,
          },
        ],
      },
    ];
  }

  /**
   * Retrieve sticky configuration for a channel.
   */
  getStickyConfig(channelId) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT * FROM sticky_configs WHERE channel_id = ?",
        channelId
      );
      const rows = [...cursor];
      return rows.length > 0 ? rows[0] : null;
    }
    return this.memoryConfigs.get(channelId) || null;
  }

  /**
   * Retrieve all enabled sticky configurations.
   */
  getAllEnabledConfigs() {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT * FROM sticky_configs WHERE enabled = 1"
      );
      return [...cursor];
    }
    const enabled = [];
    for (const config of this.memoryConfigs.values()) {
      if (config.enabled) {
        enabled.push(config);
      }
    }
    return enabled;
  }

  /**
   * Set or update sticky configuration for a channel.
   */
  setStickyConfig({
    channelId,
    guildId = null,
    messageText,
    currentMessageId = null,
    enabled = 1,
    buttonAction = null,
    buttonLabel = null,
    buttonStyle = null,
    buttonEmoji = null,
    embedData = null,
  }) {
    const now = Date.now();
    const cleanAction = buttonAction && buttonAction !== "none" ? buttonAction : null;
    let label = buttonLabel;
    let style = buttonStyle;
    let emoji = buttonEmoji;

    if (cleanAction === "punishment_center") {
      label = label || "Open Punishment Center";
      style = style || 2;
      emoji = emoji || "⚖️";
    }

    if (cleanAction === "suggestions_submit") {
      label = label || "Submit Suggestion";
      style = style || 1;
      emoji = emoji || "💡";
    }

    if (this.ctx?.storage?.sql) {
      if (embedData !== undefined && embedData !== null) {
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO sticky_configs (
            channel_id, guild_id, message_text, current_message_id, enabled, updated_at,
            button_action, button_label, button_style, button_emoji, embed_data
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          channelId,
          guildId,
          messageText,
          currentMessageId,
          enabled ? 1 : 0,
          now,
          cleanAction,
          cleanAction ? label : null,
          cleanAction ? style : null,
          cleanAction ? emoji : null,
          typeof embedData === "object" ? JSON.stringify(embedData) : String(embedData)
        );
      } else {
        this.ctx.storage.sql.exec(
          `INSERT OR REPLACE INTO sticky_configs (
            channel_id, guild_id, message_text, current_message_id, enabled, updated_at,
            button_action, button_label, button_style, button_emoji
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          channelId,
          guildId,
          messageText,
          currentMessageId,
          enabled ? 1 : 0,
          now,
          cleanAction,
          cleanAction ? label : null,
          cleanAction ? style : null,
          cleanAction ? emoji : null
        );
      }
    } else {
      this.memoryConfigs.set(channelId, {
        channel_id: channelId,
        guild_id: guildId,
        message_text: messageText,
        current_message_id: currentMessageId,
        enabled: enabled ? 1 : 0,
        updated_at: now,
        button_action: cleanAction,
        button_label: cleanAction ? label : null,
        button_style: cleanAction ? style : null,
        button_emoji: cleanAction ? emoji : null,
        embed_data: embedData || null,
      });
    }
  }

  /**
   * Update the current message ID of an active sticky message.
   */
  updateCurrentMessageId(channelId, messageId) {
    const now = Date.now();
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `UPDATE sticky_configs SET current_message_id = ?, updated_at = ? WHERE channel_id = ?`,
        messageId,
        now,
        channelId
      );
    } else {
      const existing = this.memoryConfigs.get(channelId);
      if (existing) {
        existing.current_message_id = messageId;
        existing.updated_at = now;
      }
    }
  }

  /**
   * Remove sticky configuration for a channel.
   */
  deleteStickyConfig(channelId) {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `DELETE FROM sticky_configs WHERE channel_id = ?`,
        channelId
      );
    } else {
      this.memoryConfigs.delete(channelId);
    }
  }

  /**
   * Post a sticky message via Discord REST API.
   * Uses allowed_mentions: { parse: [] } to prevent unwanted mass-mentions.
   * Attaches interactive components (buttons) if configured.
   */
  async postStickyMessage(channelId, messageText, customFetch = fetch, components = null, embeds = null) {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
    const payload = {
      allowed_mentions: {
        parse: ["users", "roles"],
      },
    };
    if (messageText && messageText.trim().length > 0 && (!embeds || embeds.length === 0)) {
      payload.content = messageText;
    }
    if (embeds && Array.isArray(embeds) && embeds.length > 0) {
      payload.embeds = embeds;
    }
    if (components && Array.isArray(components) && components.length > 0) {
      payload.components = components;
    }
    const res = await customFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to post sticky message (${res.status}): ${errText}`);
    }

    return await res.json();
  }

  /**
   * Delete a previous sticky message via Discord REST API.
   * Tolerates 404 if the message was already deleted.
   */
  async deleteStickyMessage(channelId, messageId, customFetch = fetch) {
    if (!messageId) return;
    const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
    try {
      const res = await customFetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
        },
      });

      if (!res.ok && res.status !== 404) {
        const errText = await res.text();
        console.warn(`Failed to delete previous sticky message (${res.status}): ${errText}`);
      }
    } catch (err) {
      console.warn(`Exception while deleting sticky message ${messageId}:`, err?.message);
    }
  }

  /**
   * Fetch the newest message in a channel via Discord REST API.
   */
  async getLatestMessage(channelId, customFetch = fetch) {
    const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=1`;
    const res = await customFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`Failed to fetch latest messages for channel ${channelId} (${res.status}): ${errText}`);
      return null;
    }

    const messages = await res.json();
    if (Array.isArray(messages) && messages.length > 0) {
      return messages[0];
    }
    return null;
  }

  /**
   * Poll all enabled sticky channels and refresh sticky messages if needed.
   * Runs during the scheduled (cron) event.
   */
  async pollAndRefreshStickyMessages(customFetch = fetch) {
    const configs = this.getAllEnabledConfigs();

    const results = await Promise.all(
      configs.map(async (config) => {
        const channelId = config.channel_id;
        const latestMessage = await this.getLatestMessage(channelId, customFetch);

        // If channel is empty, do nothing
        if (!latestMessage) {
          return false;
        }

        // If the latest message is already the current sticky message, do nothing
        if (latestMessage.id === config.current_message_id) {
          return false;
        }

        // The newest message is not the sticky message (new messages arrived or sticky was deleted)
        // 1. Post NEW sticky message first (including button components and embeds if configured)
        try {
          const components = this.buildStickyComponents(config);
          let embeds = null;
          if (config.embed_data) {
            try {
              const parsed =
                typeof config.embed_data === "string"
                  ? JSON.parse(config.embed_data)
                  : config.embed_data;
              embeds = Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
              console.warn("Invalid embed_data in sticky config:", e?.message);
            }
          }
          if (
            config.button_action === "suggestions_submit" &&
            (!embeds || embeds.length === 0)
          ) {
            const stickyData = buildSuggestionCenterSticky();
            if (stickyData.embed) {
              embeds = [stickyData.embed];
            }
          }
          const newMsg = await this.postStickyMessage(
            channelId,
            config.message_text,
            customFetch,
            components,
            embeds
          );
          const newMsgId = newMsg.id;

          // 2. Update stored current message ID
          const oldMsgId = config.current_message_id;
          this.updateCurrentMessageId(channelId, newMsgId);

          // 3. Delete previous sticky message if one existed and is not the new message
          if (oldMsgId && oldMsgId !== newMsgId) {
            await this.deleteStickyMessage(channelId, oldMsgId, customFetch);
          }

          return true;
        } catch (err) {
          console.error(
            `Error refreshing sticky message for channel ${channelId}:`,
            err?.message
          );
          return false;
        }
      })
    );

    const refreshedCount = results.filter(Boolean).length;
    return { total: configs.length, refreshed: refreshedCount };
  }

  /**
   * Internal API endpoint handler for Worker <-> DO communication.
   */
  async fetch(request) {
    const url = new URL(request.url);

    // 1. /sticky/set (POST)
    if (request.method === "POST" && url.pathname === "/sticky/set") {
      const {
        channelId,
        guildId,
        messageText,
        buttonAction,
        buttonLabel,
        buttonStyle,
        buttonEmoji,
        embedData,
      } = await request.json();

      const existingConfig = this.getStickyConfig(channelId);

      const components = this.buildStickyComponents({
        button_action: buttonAction,
        button_label: buttonLabel,
        button_style: buttonStyle,
        button_emoji: buttonEmoji,
      });

      let embeds = null;
      if (embedData) {
        try {
          const parsed = typeof embedData === "string" ? JSON.parse(embedData) : embedData;
          embeds = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          console.warn("Invalid embedData in /sticky/set:", e?.message);
        }
      }
      if (buttonAction === "suggestions_submit" && (!embeds || embeds.length === 0)) {
        const stickyData = buildSuggestionCenterSticky();
        if (stickyData.embed) {
          embeds = [stickyData.embed];
        }
      }

      // Post initial sticky message immediately
      const newMsg = await this.postStickyMessage(channelId, messageText, fetch, components, embeds);
      const newMsgId = newMsg.id;

      // Save new configuration in SQLite
      this.setStickyConfig({
        channelId,
        guildId,
        messageText,
        currentMessageId: newMsgId,
        enabled: 1,
        buttonAction,
        buttonLabel,
        buttonStyle,
        buttonEmoji,
        embedData: typeof embedData === "object" ? JSON.stringify(embedData) : embedData,
      });

      // Delete previous sticky message if one existed
      if (existingConfig?.current_message_id && existingConfig.current_message_id !== newMsgId) {
        await this.deleteStickyMessage(channelId, existingConfig.current_message_id);
      }

      return new Response(JSON.stringify({ ok: true, messageId: newMsgId }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. /sticky/off (POST)
    if (request.method === "POST" && url.pathname === "/sticky/off") {
      const { channelId } = await request.json();

      const existingConfig = this.getStickyConfig(channelId);
      if (existingConfig?.current_message_id) {
        await this.deleteStickyMessage(channelId, existingConfig.current_message_id);
      }

      this.deleteStickyConfig(channelId);

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. /sticky/status (GET)
    if (request.method === "GET" && url.pathname === "/sticky/status") {
      const channelId = url.searchParams.get("channelId");
      const config = this.getStickyConfig(channelId);

      return new Response(JSON.stringify(config || { enabled: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 4. /sticky/poll (POST)
    if (request.method === "POST" && url.pathname === "/sticky/poll") {
      const result = await this.pollAndRefreshStickyMessages();
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 5. /sticky/refresh (POST)
    if (request.method === "POST" && url.pathname === "/sticky/refresh") {
      const result = await this.pollAndRefreshStickyMessages();
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }
}

