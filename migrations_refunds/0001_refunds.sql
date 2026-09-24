-- Migration: 0001_refunds.sql
-- Create D1 SQL tables and indexes for Damo Bot Refund Center in dedicated damo-bot-refunds database

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_id TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_discord_id TEXT NOT NULL DEFAULT 'N/A',
  refund_category TEXT NOT NULL,
  refund_details TEXT NOT NULL,
  reason TEXT NOT NULL,
  ticket_url TEXT NOT NULL DEFAULT '',
  staff_name TEXT NOT NULL,
  staff_discord_id TEXT NOT NULL,
  guild_id TEXT NOT NULL DEFAULT '',
  log_channel_id TEXT NOT NULL DEFAULT '',
  log_message_id TEXT NOT NULL DEFAULT '',
  discord_jump_url TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'Pending',
  normalized_player_name TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS refund_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT UNIQUE NOT NULL,
  refund_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by_name TEXT NOT NULL,
  changed_by_discord_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT ''
);

-- Fast lookup indexes for query efficiency
CREATE INDEX IF NOT EXISTS idx_refunds_refund_id ON refunds(refund_id);
CREATE INDEX IF NOT EXISTS idx_refunds_player_discord_id ON refunds(player_discord_id);
CREATE INDEX IF NOT EXISTS idx_refunds_normalized_player_name ON refunds(normalized_player_name);
CREATE INDEX IF NOT EXISTS idx_refunds_staff_discord_id ON refunds(staff_discord_id);
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_refund_category ON refunds(refund_category);
CREATE INDEX IF NOT EXISTS idx_refund_audits_refund_id ON refund_audits(refund_id);
