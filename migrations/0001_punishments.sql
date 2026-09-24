-- Migration: 0001_punishments.sql
-- Create D1 SQL tables and indexes for Damo Bot Punishment Center

CREATE TABLE IF NOT EXISTS punishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  punishment_id TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_discord_id TEXT NOT NULL DEFAULT 'N/A',
  punishment TEXT NOT NULL,
  punishment_length TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  additional_info TEXT NOT NULL DEFAULT '',
  report_url TEXT NOT NULL DEFAULT '',
  response_url TEXT NOT NULL DEFAULT '',
  evidence_image_url TEXT NOT NULL DEFAULT '',
  staff_name TEXT NOT NULL,
  staff_discord_id TEXT NOT NULL,
  guild_id TEXT NOT NULL DEFAULT '',
  log_channel_id TEXT NOT NULL DEFAULT '',
  log_message_id TEXT NOT NULL DEFAULT '',
  discord_jump_url TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'Pending',
  normalized_player_name TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS punishment_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT UNIQUE NOT NULL,
  punishment_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  changed_by_name TEXT NOT NULL,
  changed_by_discord_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT ''
);

-- Fast lookup indexes for free-tier query efficiency
CREATE INDEX IF NOT EXISTS idx_punishments_punishment_id ON punishments(punishment_id);
CREATE INDEX IF NOT EXISTS idx_punishments_player_discord_id ON punishments(player_discord_id);
CREATE INDEX IF NOT EXISTS idx_punishments_normalized_player_name ON punishments(normalized_player_name);
CREATE INDEX IF NOT EXISTS idx_punishments_staff_discord_id ON punishments(staff_discord_id);
CREATE INDEX IF NOT EXISTS idx_punishments_created_at ON punishments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_punishment_audits_punishment_id ON punishment_audits(punishment_id);
