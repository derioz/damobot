-- Migration: 0002_ticket_reminders.sql
-- Create D1 SQL table and indexes for Damo Bot Ticket Reminders

CREATE TABLE IF NOT EXISTS ticket_reminders (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  thread_name TEXT NOT NULL DEFAULT '',
  parent_channel_id TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL DEFAULT 'personal', -- 'personal' | 'staff'
  reminder_message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  remind_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- 'pending' | 'sending' | 'sent' | 'cancelled'
  sent_at TEXT
);

-- Indexes for fast scheduled queries and lookup efficiency
CREATE INDEX IF NOT EXISTS idx_ticket_reminders_status_remind_at ON ticket_reminders(status, remind_at);
CREATE INDEX IF NOT EXISTS idx_ticket_reminders_thread_id ON ticket_reminders(thread_id);
CREATE INDEX IF NOT EXISTS idx_ticket_reminders_created_by ON ticket_reminders(created_by_user_id);
