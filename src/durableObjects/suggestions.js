/**
 * Durable Object for managing Vital RP Suggestions and Voting.
 * Backed by SQLite on Cloudflare Workers, with in-memory fallback for testing.
 */

export function formatSuggestionPublicId(seq) {
  const num = parseInt(seq, 10) || 0;
  return `VRP-S-${String(num).padStart(6, "0")}`;
}

export function formatSuggestionDisplayId(seq) {
  const num = parseInt(seq, 10) || 0;
  return `#${String(num).padStart(4, "0")}`;
}

export class SuggestionsDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;

    // In-memory fallbacks for unit tests without Workers SQLite
    this.memorySuggestions = new Map();
    this.memoryVotes = new Map(); // key: `${suggestionId}:${userId}`
    this.memoryCooldowns = new Map(); // key: userId -> timestamp
    this.memoryDrafts = new Map(); // key: userId -> draft

    this.initDatabase();
  }

  /**
   * Initialize SQLite tables.
   */
  initDatabase() {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS suggestions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          public_id TEXT UNIQUE NOT NULL,
          user_id TEXT NOT NULL,
          author_tag TEXT NOT NULL,
          is_anonymous INTEGER NOT NULL DEFAULT 0,
          category_id TEXT NOT NULL,
          category_label TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          url TEXT,
          attachment_url TEXT,
          attachment_name TEXT,
          message_id TEXT,
          channel_id TEXT NOT NULL,
          guild_id TEXT,
          upvotes INTEGER NOT NULL DEFAULT 0,
          downvotes INTEGER NOT NULL DEFAULT 0,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS suggestion_votes (
          suggestion_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          vote_type TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (suggestion_id, user_id)
        )
      `);

      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS user_cooldowns (
          user_id TEXT PRIMARY KEY,
          last_submitted_at INTEGER NOT NULL
        )
      `);

      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS suggestion_drafts (
          user_id TEXT PRIMARY KEY,
          draft_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      try {
        this.ctx.storage.sql.exec(
          "CREATE INDEX IF NOT EXISTS idx_suggestions_user ON suggestions(user_id, created_at)"
        );
      } catch (_) {}

      try {
        this.ctx.storage.sql.exec(
          "CREATE INDEX IF NOT EXISTS idx_suggestions_active ON suggestions(is_deleted, created_at)"
        );
      } catch (_) {}
    }
  }

  /**
   * Check if a user is currently on submission cooldown.
   *
   * @param {string} userId
   * @param {number} cooldownSeconds
   * @returns {{ onCooldown: boolean, remainingSeconds: number }}
   */
  checkCooldown(userId, cooldownSeconds = 300) {
    const now = Date.now();
    let lastSubmitted = 0;

    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT last_submitted_at FROM user_cooldowns WHERE user_id = ?",
        userId
      );
      const rows = [...cursor];
      if (rows.length > 0) {
        lastSubmitted = Number(rows[0].last_submitted_at);
      }
    } else {
      lastSubmitted = this.memoryCooldowns.get(userId) || 0;
    }

    if (!lastSubmitted) {
      return { onCooldown: false, remainingSeconds: 0 };
    }

    const elapsedSeconds = Math.floor((now - lastSubmitted) / 1000);
    if (elapsedSeconds < cooldownSeconds) {
      return {
        onCooldown: true,
        remainingSeconds: cooldownSeconds - elapsedSeconds,
      };
    }

    return { onCooldown: false, remainingSeconds: 0 };
  }

  /**
   * Record cooldown timestamp for a user.
   *
   * @param {string} userId
   * @param {number} [timestamp=Date.now()]
   */
  setCooldown(userId, timestamp = Date.now()) {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO user_cooldowns (user_id, last_submitted_at) VALUES (?, ?)`,
        userId,
        timestamp
      );
    } else {
      this.memoryCooldowns.set(userId, timestamp);
    }
  }

  /**
   * Create and persist a new suggestion record.
   *
   * @param {Object} data
   * @returns {Object} Created suggestion record
   */
  createSuggestion({
    userId,
    authorTag,
    isAnonymous = 0,
    categoryId,
    categoryLabel,
    title,
    description,
    url = null,
    attachmentUrl = null,
    attachmentName = null,
    channelId,
    guildId = null,
  }) {
    const now = Date.now();

    if (this.ctx?.storage?.sql) {
      // Calculate next sequential ID
      const cursor = this.ctx.storage.sql.exec(
        "SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM suggestions"
      );
      const nextId = Number([...cursor][0].nextId);
      const publicId = formatSuggestionPublicId(nextId);

      this.ctx.storage.sql.exec(
        `INSERT INTO suggestions (
          id, public_id, user_id, author_tag, is_anonymous, category_id, category_label,
          title, description, url, attachment_url, attachment_name, message_id,
          channel_id, guild_id, upvotes, downvotes, is_deleted, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, 0, ?, ?)`,
        nextId,
        publicId,
        userId,
        authorTag,
        isAnonymous ? 1 : 0,
        categoryId,
        categoryLabel,
        title,
        description,
        url,
        attachmentUrl,
        attachmentName,
        channelId,
        guildId,
        now,
        now
      );

      return {
        id: nextId,
        public_id: publicId,
        display_id: formatSuggestionDisplayId(nextId),
        user_id: userId,
        author_tag: authorTag,
        is_anonymous: isAnonymous ? 1 : 0,
        category_id: categoryId,
        category_label: categoryLabel,
        title,
        description,
        url,
        attachment_url: attachmentUrl,
        attachment_name: attachmentName,
        message_id: null,
        channel_id: channelId,
        guild_id: guildId,
        upvotes: 0,
        downvotes: 0,
        is_deleted: 0,
        created_at: now,
        updated_at: now,
      };
    }

    // In-memory fallback
    const nextId = this.memorySuggestions.size + 1;
    const publicId = formatSuggestionPublicId(nextId);
    const record = {
      id: nextId,
      public_id: publicId,
      display_id: formatSuggestionDisplayId(nextId),
      user_id: userId,
      author_tag: authorTag,
      is_anonymous: isAnonymous ? 1 : 0,
      category_id: categoryId,
      category_label: categoryLabel,
      title,
      description,
      url,
      attachment_url: attachmentUrl,
      attachment_name: attachmentName,
      message_id: null,
      channel_id: channelId,
      guild_id: guildId,
      upvotes: 0,
      downvotes: 0,
      is_deleted: 0,
      created_at: now,
      updated_at: now,
    };
    this.memorySuggestions.set(nextId, record);
    return record;
  }

  /**
   * Update the Discord message ID for a posted suggestion.
   *
   * @param {number|string} suggestionId
   * @param {string} messageId
   */
  updateMessageId(suggestionId, messageId) {
    const id = parseInt(suggestionId, 10);
    const now = Date.now();
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        "UPDATE suggestions SET message_id = ?, updated_at = ? WHERE id = ?",
        messageId,
        now,
        id
      );
    } else {
      const record = this.memorySuggestions.get(id);
      if (record) {
        record.message_id = messageId;
        record.updated_at = now;
      }
    }
  }

  /**
   * Retrieve a suggestion record by ID, public ID, or message ID.
   *
   * @param {number|string} identifier
   * @returns {Object|null}
   */
  getSuggestion(identifier) {
    if (!identifier) return null;

    if (this.ctx?.storage?.sql) {
      let query = "SELECT * FROM suggestions WHERE ";
      let param = identifier;

      if (Number.isInteger(Number(identifier)) && !String(identifier).startsWith("VRP-S-")) {
        query += "id = ?";
        param = parseInt(identifier, 10);
      } else if (String(identifier).startsWith("VRP-S-")) {
        query += "public_id = ?";
      } else {
        query += "message_id = ?";
      }

      const cursor = this.ctx.storage.sql.exec(query, param);
      const rows = [...cursor];
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        ...row,
        display_id: formatSuggestionDisplayId(row.id),
      };
    }

    // In-memory fallback
    for (const record of this.memorySuggestions.values()) {
      if (
        record.id === parseInt(identifier, 10) ||
        record.public_id === identifier ||
        record.message_id === identifier
      ) {
        return { ...record };
      }
    }
    return null;
  }

  /**
   * Handle an atomic vote action on a suggestion.
   * Toggle rules:
   * - Click same vote: Removes vote
   * - Click opposite vote: Switches vote
   * - No existing vote: Adds vote
   *
   * @param {Object} options
   * @param {number|string} options.suggestionId
   * @param {string} options.userId
   * @param {"up"|"down"} options.voteType
   * @returns {{ ok: boolean, error?: string, upvotes: number, downvotes: number, currentVote: string|null, messageId?: string, channelId?: string }}
   */
  voteSuggestion({ suggestionId, userId, voteType }) {
    const id = parseInt(suggestionId, 10);
    const suggestion = this.getSuggestion(id);

    if (!suggestion) {
      return { ok: false, error: "Suggestion not found." };
    }
    if (suggestion.is_deleted) {
      return { ok: false, error: "This suggestion is no longer available." };
    }

    const now = Date.now();
    let currentVote = null;

    if (this.ctx?.storage?.sql) {
      // Find existing vote
      const cursor = this.ctx.storage.sql.exec(
        "SELECT vote_type FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?",
        id,
        userId
      );
      const rows = [...cursor];
      const existingVote = rows.length > 0 ? rows[0].vote_type : null;

      if (existingVote === voteType) {
        // Toggle OFF
        this.ctx.storage.sql.exec(
          "DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?",
          id,
          userId
        );
        currentVote = null;
      } else if (existingVote) {
        // Switch vote
        this.ctx.storage.sql.exec(
          "UPDATE suggestion_votes SET vote_type = ?, created_at = ? WHERE suggestion_id = ? AND user_id = ?",
          voteType,
          now,
          id,
          userId
        );
        currentVote = voteType;
      } else {
        // New vote
        this.ctx.storage.sql.exec(
          "INSERT INTO suggestion_votes (suggestion_id, user_id, vote_type, created_at) VALUES (?, ?, ?, ?)",
          id,
          userId,
          voteType,
          now
        );
        currentVote = voteType;
      }

      // Recount totals
      const countCursor = this.ctx.storage.sql.exec(
        `SELECT
          COALESCE(SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END), 0) AS upvotes,
          COALESCE(SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END), 0) AS downvotes
         FROM suggestion_votes WHERE suggestion_id = ?`,
        id
      );
      const counts = [...countCursor][0];
      const upvotes = Number(counts.upvotes);
      const downvotes = Number(counts.downvotes);

      // Update suggestion record
      this.ctx.storage.sql.exec(
        "UPDATE suggestions SET upvotes = ?, downvotes = ?, updated_at = ? WHERE id = ?",
        upvotes,
        downvotes,
        now,
        id
      );

      return {
        ok: true,
        upvotes,
        downvotes,
        currentVote,
        messageId: suggestion.message_id,
        channelId: suggestion.channel_id,
      };
    }

    // In-memory fallback
    const voteKey = `${id}:${userId}`;
    const existingVote = this.memoryVotes.get(voteKey);

    if (existingVote === voteType) {
      this.memoryVotes.delete(voteKey);
      currentVote = null;
    } else {
      this.memoryVotes.set(voteKey, voteType);
      currentVote = voteType;
    }

    // Tally in memory
    let upvotes = 0;
    let downvotes = 0;
    for (const [key, type] of this.memoryVotes.entries()) {
      if (key.startsWith(`${id}:`)) {
        if (type === "up") upvotes++;
        if (type === "down") downvotes++;
      }
    }

    suggestion.upvotes = upvotes;
    suggestion.downvotes = downvotes;
    suggestion.updated_at = now;

    return {
      ok: true,
      upvotes,
      downvotes,
      currentVote,
      messageId: suggestion.message_id,
      channelId: suggestion.channel_id,
    };
  }

  /**
   * Get suggestions submitted by a specific user (including anonymous ones).
   *
   * @param {string} userId
   * @param {number} [limit=5]
   * @returns {Array<Object>}
   */
  getUserSuggestions(userId, limit = 5) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM suggestions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        userId,
        limit
      );
      return [...cursor].map((row) => ({
        ...row,
        display_id: formatSuggestionDisplayId(row.id),
      }));
    }

    const list = [];
    for (const record of this.memorySuggestions.values()) {
      if (record.user_id === userId) {
        list.push({ ...record });
      }
    }
    list.sort((a, b) => b.created_at - a.created_at);
    return list.slice(0, limit);
  }

  /**
   * Get top active suggestions ranked by net score (upvotes - downvotes DESC, upvotes DESC).
   *
   * @param {number} [limit=5]
   * @returns {Array<Object>}
   */
  getTopSuggestions(limit = 5) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM suggestions
         WHERE is_deleted = 0
         ORDER BY (upvotes - downvotes) DESC, upvotes DESC, created_at DESC
         LIMIT ?`,
        limit
      );
      return [...cursor].map((row) => ({
        ...row,
        display_id: formatSuggestionDisplayId(row.id),
      }));
    }

    const list = [];
    for (const record of this.memorySuggestions.values()) {
      if (!record.is_deleted) {
        list.push({ ...record });
      }
    }
    list.sort((a, b) => {
      const scoreA = a.upvotes - a.downvotes;
      const scoreB = b.upvotes - b.downvotes;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.upvotes - a.upvotes;
    });
    return list.slice(0, limit);
  }

  /**
   * Get most recent active suggestions.
   *
   * @param {number} [limit=5]
   * @returns {Array<Object>}
   */
  getRecentSuggestions(limit = 5) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        `SELECT * FROM suggestions
         WHERE is_deleted = 0
         ORDER BY created_at DESC
         LIMIT ?`,
        limit
      );
      return [...cursor].map((row) => ({
        ...row,
        display_id: formatSuggestionDisplayId(row.id),
      }));
    }

    const list = [];
    for (const record of this.memorySuggestions.values()) {
      if (!record.is_deleted) {
        list.push({ ...record });
      }
    }
    list.sort((a, b) => b.created_at - a.created_at);
    return list.slice(0, limit);
  }

  /**
   * Mark a suggestion as deleted (e.g. when staff delete the public message).
   *
   * @param {number|string} suggestionId
   */
  markSuggestionDeleted(suggestionId) {
    const id = parseInt(suggestionId, 10);
    const now = Date.now();
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        "UPDATE suggestions SET is_deleted = 1, updated_at = ? WHERE id = ?",
        id,
        now
      );
    } else {
      const record = this.memorySuggestions.get(id);
      if (record) {
        record.is_deleted = 1;
        record.updated_at = now;
      }
    }
  }

  /**
   * Save an ephemeral draft for a user during the suggestion creation flow.
   *
   * @param {string} userId
   * @param {Object} draft
   */
  saveDraft(userId, draft) {
    const now = Date.now();
    const draftJson = JSON.stringify(draft);
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        `INSERT INTO suggestion_drafts (user_id, draft_json, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET draft_json = excluded.draft_json, created_at = excluded.created_at`,
        userId,
        draftJson,
        now
      );
    } else {
      this.memoryDrafts.set(userId, { ...draft, updated_at: now });
    }
  }

  /**
   * Retrieve a user's active draft.
   *
   * @param {string} userId
   * @returns {Object|null}
   */
  getDraft(userId) {
    if (this.ctx?.storage?.sql) {
      const cursor = this.ctx.storage.sql.exec(
        "SELECT draft_json FROM suggestion_drafts WHERE user_id = ?",
        userId
      );
      const rows = [...cursor];
      if (rows.length > 0) {
        try {
          return JSON.parse(rows[0].draft_json);
        } catch {
          return null;
        }
      }
      return null;
    }
    return this.memoryDrafts.get(userId) || null;
  }

  /**
   * Delete an active draft after submission or cancellation.
   *
   * @param {string} userId
   */
  deleteDraft(userId) {
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(
        "DELETE FROM suggestion_drafts WHERE user_id = ?",
        userId
      );
    } else {
      this.memoryDrafts.delete(userId);
    }
  }

  /**
   * Internal HTTP router for Worker <-> DO calls.
   */
  async fetch(request, ...args) {
    const req = typeof request === "string" ? new Request(request, args[0]) : request;
    const url = new URL(req.url);

    // /suggestions/cooldown (GET)
    if (req.method === "GET" && url.pathname === "/suggestions/cooldown") {
      const userId = url.searchParams.get("userId");
      const seconds = parseInt(url.searchParams.get("cooldownSeconds") || "300", 10);
      const result = this.checkCooldown(userId, seconds);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/create (POST)
    if (req.method === "POST" && url.pathname === "/suggestions/create") {
      const payload = await req.json();
      const record = this.createSuggestion(payload);
      if (payload.setCooldown) {
        this.setCooldown(payload.userId);
      }
      return new Response(JSON.stringify(record), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/update-message (POST)
    if (req.method === "POST" && url.pathname === "/suggestions/update-message") {
      const { suggestionId, messageId } = await req.json();
      this.updateMessageId(suggestionId, messageId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/vote (POST)
    if (req.method === "POST" && url.pathname === "/suggestions/vote") {
      const payload = await req.json();
      const result = this.voteSuggestion(payload);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/get (GET)
    if (req.method === "GET" && url.pathname === "/suggestions/get") {
      const id = url.searchParams.get("id");
      const record = this.getSuggestion(id);
      return new Response(JSON.stringify(record || null), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/mine (GET)
    if (req.method === "GET" && url.pathname === "/suggestions/mine") {
      const userId = url.searchParams.get("userId");
      const limit = parseInt(url.searchParams.get("limit") || "5", 10);
      const list = this.getUserSuggestions(userId, limit);
      return new Response(JSON.stringify(list), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/top (GET)
    if (req.method === "GET" && url.pathname === "/suggestions/top") {
      const limit = parseInt(url.searchParams.get("limit") || "5", 10);
      const list = this.getTopSuggestions(limit);
      return new Response(JSON.stringify(list), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/recent (GET)
    if (req.method === "GET" && url.pathname === "/suggestions/recent") {
      const limit = parseInt(url.searchParams.get("limit") || "5", 10);
      const list = this.getRecentSuggestions(limit);
      return new Response(JSON.stringify(list), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/delete (POST)
    if (req.method === "POST" && url.pathname === "/suggestions/delete") {
      const { suggestionId } = await req.json();
      this.markSuggestionDeleted(suggestionId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/draft/save (POST)
    if (req.method === "POST" && url.pathname === "/suggestions/draft/save") {
      const { userId, draft } = await req.json();
      this.saveDraft(userId, draft);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/draft/get (GET)
    if (req.method === "GET" && url.pathname === "/suggestions/draft/get") {
      const userId = url.searchParams.get("userId");
      const draft = this.getDraft(userId);
      return new Response(JSON.stringify(draft || null), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // /suggestions/draft/delete (POST)
    if (req.method === "POST" && url.pathname === "/suggestions/draft/delete") {
      const { userId } = await req.json();
      this.deleteDraft(userId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }
}
