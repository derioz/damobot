/**
 * Slash Command Handlers for /suggestions:
 * Subcommands:
 * - /suggestions mine
 * - /suggestions top
 * - /suggestions recent
 * - /suggestions setup
 */

import {
  suggestionsConfig,
  getCategoryById,
} from "../../config/suggestions.config.js";
import { buildSuggestionCenterSticky } from "./components.js";
import {
  ephemeralTextResponse,
  getUserFromInteraction,
} from "../../shared/discord.js";
import { requireStaffRole, requireSuperadmin } from "../../shared/permissions.js";

/**
 * Handle /suggestions slash command and its subcommands.
 *
 * @param {Object} interaction
 * @param {Object} env
 * @returns {Promise<Response>}
 */
export async function handleSuggestionsCommand(interaction, env) {
  const subCommand = interaction.data?.options?.[0];
  const subCommandName = subCommand?.name;
  const options = subCommand?.options || [];
  const user = getUserFromInteraction(interaction);

  if (!env.SUGGESTIONS) {
    return ephemeralTextResponse("❌ Suggestions system is currently unavailable.");
  }

  const doId = env.SUGGESTIONS.idFromName("global");
  const stub = env.SUGGESTIONS.get(doId);

  // 1. /suggestions mine
  if (subCommandName === "mine") {
    try {
      const res = await stub.fetch(
        `https://do/suggestions/mine?userId=${user.id}&limit=${suggestionsConfig.limits.mySuggestionsLimit}`
      );
      const suggestions = await res.json();

      if (!suggestions || suggestions.length === 0) {
        return ephemeralTextResponse(
          "📋 **My Suggestions**\n\nYou haven't submitted any suggestions yet. Use the **Submit Suggestion** button in the suggestions channel to share your ideas!"
        );
      }

      const lines = [
        "📋 **Your Suggestions** (Recent submissions):",
        "",
      ];

      for (const s of suggestions) {
        const cat = getCategoryById(s.category_id) || { emoji: "💡" };
        const statusNotice = s.is_deleted ? " `[Deleted]`" : "";
        const anonBadge = s.is_anonymous ? " `[Anonymous]`" : "";
        lines.push(
          `**${s.display_id}** • ${cat.emoji} **${s.title}**${anonBadge}${statusNotice}`
        );
        lines.push(`👍 ${s.upvotes || 0}  |  👎 ${s.downvotes || 0}`);
        lines.push("");
      }

      lines.push("-# Visible only to you. Anonymous status is hidden on the public feed.");

      return ephemeralTextResponse(lines.join("\n"));
    } catch (err) {
      console.error("Error fetching user suggestions:", err);
      return ephemeralTextResponse("❌ Could not retrieve your suggestions at this time.");
    }
  }

  // 2. /suggestions top
  if (subCommandName === "top") {
    try {
      const res = await stub.fetch(
        `https://do/suggestions/top?limit=${suggestionsConfig.limits.topSuggestionsLimit}`
      );
      const topList = await res.json();

      if (!topList || topList.length === 0) {
        return ephemeralTextResponse("📊 **Top Suggestions**\n\nNo active suggestions available yet.");
      }

      const lines = [
        "📊 **Top Community Suggestions**:",
        "",
      ];

      for (const s of topList) {
        const cat = getCategoryById(s.category_id) || { emoji: "💡" };
        lines.push(
          `**${s.display_id}** • ${cat.emoji} **${s.title}**`
        );
        lines.push(`👍 ${s.upvotes || 0}  |  👎 ${s.downvotes || 0}`);
        lines.push("");
      }

      return ephemeralTextResponse(lines.join("\n"));
    } catch (err) {
      console.error("Error fetching top suggestions:", err);
      return ephemeralTextResponse("❌ Could not retrieve top suggestions at this time.");
    }
  }

  // 3. /suggestions recent
  if (subCommandName === "recent") {
    try {
      const res = await stub.fetch(
        `https://do/suggestions/recent?limit=${suggestionsConfig.limits.recentSuggestionsLimit}`
      );
      const recentList = await res.json();

      if (!recentList || recentList.length === 0) {
        return ephemeralTextResponse("🕒 **Recent Suggestions**\n\nNo active suggestions submitted yet.");
      }

      const lines = [
        "🕒 **Recent Community Suggestions**:",
        "",
      ];

      for (const s of recentList) {
        const cat = getCategoryById(s.category_id) || { emoji: "💡" };
        lines.push(
          `**${s.display_id}** • ${cat.emoji} **${s.title}**`
        );
        lines.push(`👍 ${s.upvotes || 0}  |  👎 ${s.downvotes || 0}`);
        lines.push("");
      }

      return ephemeralTextResponse(lines.join("\n"));
    } catch (err) {
      console.error("Error fetching recent suggestions:", err);
      return ephemeralTextResponse("❌ Could not retrieve recent suggestions at this time.");
    }
  }

  // 4. /suggestions setup [channel] (Superadmin Only)
  if (subCommandName === "setup") {
    const authError = requireSuperadmin(
      interaction,
      env,
      "❌ Only bot superadmins can configure the Suggestion Center."
    );
    if (authError) return authError;

    const channelOption = options.find((opt) => opt.name === "channel");
    const targetChannelId =
      channelOption?.value ||
      interaction.channel_id ||
      suggestionsConfig.channels.getActiveChannelId(env);

    if (!env.STICKY_BOT) {
      return ephemeralTextResponse("❌ StickyBot Durable Object is not configured.");
    }

    try {
      const stickyDoId = env.STICKY_BOT.idFromName("global");
      const stickyStub = env.STICKY_BOT.get(stickyDoId);

      const { messageText, embed } = buildSuggestionCenterSticky();
      const guildId = interaction.guild_id || env.DISCORD_GUILD_ID || null;

      const setRes = await stickyStub.fetch("https://do/sticky/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: targetChannelId,
          guildId,
          messageText,
          buttonAction: "suggestions_submit",
          buttonLabel: "Submit Suggestion",
          buttonStyle: 1, // PRIMARY
          buttonEmoji: "💡",
          embedData: embed,
        }),
      });

      if (!setRes.ok) {
        const errText = await setRes.text();
        throw new Error(`Failed to configure sticky: ${errText}`);
      }

      return ephemeralTextResponse(
        `✅ **Suggestion Center active in <#${targetChannelId}>.**`
      );
    } catch (err) {
      console.error("Error setting up Suggestion Center:", err);
      return ephemeralTextResponse(`❌ Error setting up Suggestion Center: ${err.message}`);
    }
  }

  return ephemeralTextResponse("Unknown suggestions subcommand.");
}
