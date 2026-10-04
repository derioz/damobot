import {
  MOCK_BOT_STATUS,
  MOCK_CURRENT_USER,
  MOCK_DISCORD_CHANNELS,
  MOCK_DISCORD_ROLES,
  MOCK_MODULE_DEFINITIONS,
  MOCK_AUDIT_LOGS,
} from "./mockData";
import { ModuleDefinition, ModuleId } from "../types/modules";
import { DiscordChannel, DiscordRole, DashboardAuthUser } from "../types/discord";
import { AuditLogEntry, BotStatusResponse } from "../types/audit";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "";
const STORAGE_PREFIX = "damobot_config_";

// Helper for local mock storage
function getStoredModules(): ModuleDefinition[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}modules`);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse stored modules", err);
  }
  return MOCK_MODULE_DEFINITIONS;
}

function saveStoredModules(modules: ModuleDefinition[]) {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}modules`, JSON.stringify(modules));
  } catch (err) {
    console.error("Failed to save modules", err);
  }
}

function getStoredAuditLogs(): AuditLogEntry[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}audit_logs`);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse audit logs", err);
  }
  return MOCK_AUDIT_LOGS;
}

function appendAuditLog(entry: Omit<AuditLogEntry, "id" | "timestamp">) {
  const current = getStoredAuditLogs();
  const newEntry: AuditLogEntry = {
    ...entry,
    id: `aud-${Date.now()}`,
    timestamp: new Date().toISOString(),
  };
  const updated = [newEntry, ...current];
  try {
    localStorage.setItem(`${STORAGE_PREFIX}audit_logs`, JSON.stringify(updated));
  } catch (err) {
    console.error("Failed to save audit log", err);
  }
}

export const api = {
  // Auth
  async getCurrentUser(): Promise<DashboardAuthUser> {
    if (!API_BASE) {
      return MOCK_CURRENT_USER;
    }
    const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
    if (!res.ok) throw new Error("Unauthorized");
    return res.json();
  },

  async logout(): Promise<void> {
    if (!API_BASE) {
      console.log("Mock logout");
      return;
    }
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  },

  // Bot Status
  async getBotStatus(): Promise<BotStatusResponse> {
    if (!API_BASE) {
      const modules = getStoredModules();
      const activeCount = modules.filter((m) => m.enabled).length;
      return {
        ...MOCK_BOT_STATUS,
        activeModulesCount: activeCount,
        totalModulesCount: modules.length,
      };
    }
    const res = await fetch(`${API_BASE}/api/dashboard/status`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to fetch bot status");
    return res.json();
  },

  // Modules
  async getModules(): Promise<ModuleDefinition[]> {
    if (!API_BASE) {
      return getStoredModules();
    }
    const res = await fetch(`${API_BASE}/api/modules`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to fetch modules");
    return res.json();
  },

  async getModule(id: ModuleId): Promise<ModuleDefinition | undefined> {
    const modules = await this.getModules();
    return modules.find((m) => m.id === id);
  },

  async toggleModule(id: ModuleId, enabled: boolean): Promise<ModuleDefinition> {
    if (!API_BASE) {
      const modules = getStoredModules();
      const mod = modules.find((m) => m.id === id);
      if (!mod) throw new Error("Module not found");
      mod.enabled = enabled;
      saveStoredModules(modules);
      appendAuditLog({
        userId: MOCK_CURRENT_USER.id,
        userName: MOCK_CURRENT_USER.displayName,
        moduleId: id,
        moduleName: mod.name,
        action: enabled ? "enable_module" : "disable_module",
        key: "enabled",
        oldValue: !enabled,
        newValue: enabled,
      });
      return mod;
    }
    const res = await fetch(`${API_BASE}/api/modules/${id}/${enabled ? "enable" : "disable"}`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to toggle module");
    return res.json();
  },

  async updateModuleSettings(id: ModuleId, settings: Record<string, any>): Promise<ModuleDefinition> {
    if (!API_BASE) {
      const modules = getStoredModules();
      const mod = modules.find((m) => m.id === id);
      if (!mod) throw new Error("Module not found");
      
      // Update default values in schema
      for (const [key, value] of Object.entries(settings)) {
        const schema = mod.settingsSchema.find((s) => s.key === key);
        if (schema) {
          const old = schema.defaultValue;
          schema.defaultValue = value;
          appendAuditLog({
            userId: MOCK_CURRENT_USER.id,
            userName: MOCK_CURRENT_USER.displayName,
            moduleId: id,
            moduleName: mod.name,
            action: "update_setting",
            key,
            oldValue: typeof old === "object" ? JSON.stringify(old) : old,
            newValue: typeof value === "object" ? JSON.stringify(value) : value,
          });
        }
      }
      saveStoredModules(modules);
      return mod;
    }

    const res = await fetch(`${API_BASE}/api/modules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to update module settings");
    return res.json();
  },

  // Discord Resources
  async getDiscordRoles(): Promise<DiscordRole[]> {
    if (!API_BASE) {
      return MOCK_DISCORD_ROLES;
    }
    const res = await fetch(`${API_BASE}/api/discord/roles`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to fetch Discord roles");
    return res.json();
  },

  async getDiscordChannels(): Promise<DiscordChannel[]> {
    if (!API_BASE) {
      return MOCK_DISCORD_CHANNELS;
    }
    const res = await fetch(`${API_BASE}/api/discord/channels`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to fetch Discord channels");
    return res.json();
  },

  // Audit Logs
  async getAuditLogs(): Promise<AuditLogEntry[]> {
    if (!API_BASE) {
      return getStoredAuditLogs();
    }
    const res = await fetch(`${API_BASE}/api/audit-log`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to fetch audit log");
    return res.json();
  },
};
