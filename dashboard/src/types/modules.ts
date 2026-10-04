export type ModuleId =
  | "loa"
  | "punishments"
  | "refunds"
  | "suggestions"
  | "referrals"
  | "reminders"
  | "stickies"
  | "overview"
  | "admin-chat";

export interface SettingFieldSchema {
  key: string;
  label: string;
  description: string;
  type:
    | "boolean"
    | "string"
    | "number"
    | "textarea"
    | "discord_role"
    | "discord_roles"
    | "discord_channel"
    | "discord_channels"
    | "select"
    | "categories_refund"
    | "categories_suggestion"
    | "string_array";
  options?: { label: string; value: string }[];
  defaultValue?: any;
  danger?: boolean;
  requiresConfirm?: boolean;
}

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  description: string;
  category: "staff" | "community" | "utility";
  iconName: string;
  staffOnly: boolean;
  enabled: boolean;
  version: string;
  configurable: boolean;
  settingsSchema: SettingFieldSchema[];
  stats?: {
    label: string;
    value: string | number;
  }[];
}
