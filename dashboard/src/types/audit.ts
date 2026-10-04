export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  moduleId: string;
  moduleName: string;
  action: "update_setting" | "enable_module" | "disable_module" | "bulk_update";
  key: string;
  oldValue: any;
  newValue: any;
}

export interface BotStatusResponse {
  status: "online" | "degraded" | "offline";
  botName: string;
  version: string;
  guildId: string;
  guildName: string;
  guildIcon?: string;
  uptime: string;
  activeModulesCount: number;
  totalModulesCount: number;
  d1Databases: {
    name: string;
    binding: string;
    connected: boolean;
  }[];
  durableObjects: {
    name: string;
    class: string;
    status: "active" | "standby";
  }[];
  environment: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  lastConfigUpdate: string;
}
