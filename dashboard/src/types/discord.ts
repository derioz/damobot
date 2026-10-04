export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0 = text, 2 = voice, 4 = category, 5 = announcement, 15 = forum
  parentId?: string | null;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
}

export interface DashboardAuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  roles: string[];
  roleName: string;
  accessLevel: "owner" | "admin" | "manager" | "readonly";
  permissions: {
    canManageAll: boolean;
    canManageModules: boolean;
    canViewAudit: boolean;
    canEditSystem: boolean;
  };
}
