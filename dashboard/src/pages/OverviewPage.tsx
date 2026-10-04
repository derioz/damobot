import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes,
  Database,
  Layers,
  Activity,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Sliders,
} from "lucide-react";
import { SpotlightCard } from "../components/ui/SpotlightCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ModuleDefinition } from "../types/modules";
import { BotStatusResponse, AuditLogEntry } from "../types/audit";

interface OverviewPageProps {
  modules: ModuleDefinition[];
  botStatus?: BotStatusResponse;
  recentAudits: AuditLogEntry[];
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  modules,
  botStatus,
  recentAudits,
}) => {
  const navigate = useNavigate();

  const enabledCount = modules.filter((m) => m.enabled).length;
  const disabledCount = modules.length - enabledCount;

  return (
    <div className="space-y-8">
      {/* Top Welcome & Quick Status Banner */}
      <div className="relative rounded-2xl border border-dark-750 bg-gradient-to-r from-dark-850 via-dark-900 to-dark-850 p-6 md:p-8 overflow-hidden shadow-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand-orange/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <Badge variant="brand">Vital RP Official</Badge>
              <Badge variant="success" dot>
                {botStatus?.status === "online" ? "System Operational" : "Degraded"}
              </Badge>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-100">
              DamoBot Management Center
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
              Real-time configuration, feature toggles, role permissions, and channel routing for
              the Vital RP Discord infrastructure without editing code or redeploying manually.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="md"
              icon={<Boxes className="w-4 h-4" />}
              onClick={() => navigate("/modules")}
            >
              Manage Modules
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={<Sliders className="w-4 h-4" />}
              onClick={() => navigate("/audit")}
            >
              View Audit Log
            </Button>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Active Modules */}
        <SpotlightCard className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Active Modules
            </span>
            <div className="p-2 rounded-lg bg-brand-orangeMuted text-brand-orange">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-100">{enabledCount}</span>
            <span className="text-xs text-slate-400">/ {modules.length} modules</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{disabledCount === 0 ? "All modules enabled" : `${disabledCount} disabled`}</span>
          </div>
        </SpotlightCard>

        {/* Metric 2: D1 Databases */}
        <SpotlightCard className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Cloudflare D1
            </span>
            <div className="p-2 rounded-lg bg-discord-blurple/15 text-discord-blurple">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-100">
              {botStatus?.d1Databases?.length || 2}
            </span>
            <span className="text-xs text-slate-400">Databases</span>
          </div>
          <div className="mt-2 text-xs text-slate-400 truncate">
            Punishments & Refunds Storage
          </div>
        </SpotlightCard>

        {/* Metric 3: Durable Objects */}
        <SpotlightCard className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Durable Objects
            </span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-100">
              {botStatus?.durableObjects?.length || 4}
            </span>
            <span className="text-xs text-slate-400">Active DOs</span>
          </div>
          <div className="mt-2 text-xs text-slate-400 truncate">
            Sticky, LOA, Sequence & Suggestions
          </div>
        </SpotlightCard>

        {/* Metric 4: Guild Connection */}
        <SpotlightCard className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Discord Guild
            </span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-xl font-extrabold text-slate-100 truncate">
              {botStatus?.guildName || "Vital RP"}
            </span>
          </div>
          <div className="mt-2 text-xs font-mono text-slate-400 truncate">
            ID: {botStatus?.guildId || "730015674348601384"}
          </div>
        </SpotlightCard>
      </div>

      {/* Main Grid: Module Fast Launcher & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Modules Fast Cards (2 columns on lg) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Boxes className="w-5 h-5 text-brand-orange" />
              Core DamoBot Modules
            </h2>
            <button
              onClick={() => navigate("/modules")}
              className="text-xs font-medium text-brand-orange hover:text-brand-orangeHover transition-colors flex items-center gap-1"
            >
              View All <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {modules.slice(0, 6).map((mod) => (
              <SpotlightCard
                key={mod.id}
                onClick={() => navigate(`/modules/${mod.id}`)}
                className="cursor-pointer group hover:border-brand-orange/40 transition-all p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-100 group-hover:text-brand-orange transition-colors">
                        {mod.name}
                      </span>
                      {mod.staffOnly && (
                        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-dark-750 text-slate-400 font-mono">
                          Staff
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {mod.description}
                    </p>
                  </div>
                  <Badge variant={mod.enabled ? "success" : "danger"} dot>
                    {mod.enabled ? "Active" : "Off"}
                  </Badge>
                </div>

                {mod.stats && (
                  <div className="mt-4 pt-3 border-t border-dark-750/70 flex items-center justify-between text-xs text-slate-400">
                    <span>{mod.stats[0]?.label}</span>
                    <span className="font-semibold text-slate-200">
                      {mod.stats[0]?.value}
                    </span>
                  </div>
                )}
              </SpotlightCard>
            ))}
          </div>
        </div>

        {/* Recent Configuration Activity */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Recent Changes
            </h2>
            <button
              onClick={() => navigate("/audit")}
              className="text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              Full Log
            </button>
          </div>

          <div className="rounded-xl border border-dark-750 bg-dark-850 p-4 space-y-3">
            {recentAudits.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No recent configuration modifications recorded.
              </div>
            ) : (
              recentAudits.slice(0, 4).map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 rounded-lg bg-dark-900 border border-dark-750/60 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">
                      {entry.userName}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(entry.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="text-slate-400">
                    Modified <span className="text-brand-orange">{entry.moduleName}</span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-300 bg-dark-950 px-2 py-1 rounded border border-dark-750 truncate">
                    {entry.key}: {String(entry.newValue)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
