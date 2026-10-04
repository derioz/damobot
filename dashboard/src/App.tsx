import React, { useState, useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { OverviewPage } from "./pages/OverviewPage";
import { ModulesPage } from "./pages/ModulesPage";
import { ModuleDetailPage } from "./pages/ModuleDetailPage";
import { DiscordSettingsPage } from "./pages/DiscordSettingsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { LoginPage } from "./pages/LoginPage";
import { api } from "./services/api";
import { ModuleDefinition, ModuleId } from "./types/modules";
import { DiscordRole, DiscordChannel, DashboardAuthUser } from "./types/discord";
import { BotStatusResponse, AuditLogEntry } from "./types/audit";
import { SkeletonCard } from "./components/ui/SkeletonLoader";

export const App: React.FC = () => {
  const [user, setUser] = useState<DashboardAuthUser | null>(null);
  const [modules, setModules] = useState<ModuleDefinition[]>([]);
  const [discordRoles, setDiscordRoles] = useState<DiscordRole[]>([]);
  const [discordChannels, setDiscordChannels] = useState<DiscordChannel[]>([]);
  const [botStatus, setBotStatus] = useState<BotStatusResponse | undefined>();
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Initialize data
  useEffect(() => {
    async function loadInitialData() {
      try {
        const [
          currentUser,
          modList,
          rolesList,
          channelsList,
          statusData,
          logsData,
        ] = await Promise.all([
          api.getCurrentUser(),
          api.getModules(),
          api.getDiscordRoles(),
          api.getDiscordChannels(),
          api.getBotStatus(),
          api.getAuditLogs(),
        ]);

        setUser(currentUser);
        setModules(modList);
        setDiscordRoles(rolesList);
        setDiscordChannels(channelsList);
        setBotStatus(statusData);
        setAuditLogs(logsData);
      } catch (err) {
        console.warn("API offline or unauthenticated, falling back to mock mode", err);
      } finally {
        setLoading(false);
      }
    }

    loadInitialData();
  }, []);

  const handleToggleModule = async (id: ModuleId, enabled: boolean) => {
    try {
      const updated = await api.toggleModule(id, enabled);
      setModules((prev) => prev.map((m) => (m.id === id ? { ...m, enabled: updated.enabled } : m)));
      // Refresh audit logs
      const updatedLogs = await api.getAuditLogs();
      setAuditLogs(updatedLogs);
    } catch (err) {
      console.error("Toggle error", err);
    }
  };

  const handleSaveSettings = async (id: ModuleId, settings: Record<string, any>) => {
    const updated = await api.updateModuleSettings(id, settings);
    setModules((prev) => prev.map((m) => (m.id === id ? updated : m)));
    const updatedLogs = await api.getAuditLogs();
    setAuditLogs(updatedLogs);
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
  };

  const handleLoginWithDiscord = () => {
    // In live mode, redirects to Cloudflare Worker auth endpoint
    const apiBase = (import.meta as any).env?.VITE_API_BASE_URL || "";
    if (apiBase) {
      window.location.href = `${apiBase}/api/auth/login`;
    } else {
      // In local mode, immediately authenticates with mock user
      api.getCurrentUser().then(setUser);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-dark-950 p-6">
        <div className="w-full max-w-xl space-y-4">
          <SkeletonCard />
        </div>
      </div>
    );
  }

  // If user is not authenticated, show login page
  if (!user) {
    return (
      <LoginPage
        onLoginWithDiscord={handleLoginWithDiscord}
        onDemoLogin={() => api.getCurrentUser().then(setUser)}
      />
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Layout
              user={user}
              modules={modules}
              botStatus={botStatus}
              onLogout={handleLogout}
            />
          }
        >
          <Route
            index
            element={
              <OverviewPage
                modules={modules}
                botStatus={botStatus}
                recentAudits={auditLogs}
              />
            }
          />
          <Route
            path="modules"
            element={
              <ModulesPage
                modules={modules}
                onToggleModule={handleToggleModule}
              />
            }
          />
          <Route
            path="modules/:moduleId"
            element={
              <ModuleDetailPage
                modules={modules}
                discordRoles={discordRoles}
                discordChannels={discordChannels}
                onSaveSettings={handleSaveSettings}
              />
            }
          />
          <Route
            path="discord"
            element={
              <DiscordSettingsPage
                roles={discordRoles}
                channels={discordChannels}
              />
            }
          />
          <Route path="audit" element={<AuditLogPage logs={auditLogs} />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
};
