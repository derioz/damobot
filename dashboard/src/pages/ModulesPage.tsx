import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes,
  Sliders,
  CalendarOff,
  ShieldAlert,
  Receipt,
  Lightbulb,
  Users,
  Clock,
  Pin,
  MessageSquare,
  Activity,
} from "lucide-react";
import { SpotlightCard } from "../components/ui/SpotlightCard";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ToggleSwitch } from "../components/ui/ToggleSwitch";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { ModuleDefinition, ModuleId } from "../types/modules";

interface ModulesPageProps {
  modules: ModuleDefinition[];
  onToggleModule: (id: ModuleId, enabled: boolean) => Promise<void>;
}

export const ModulesPage: React.FC<ModulesPageProps> = ({
  modules,
  onToggleModule,
}) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "staff" | "community" | "utility">("all");
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    moduleId: ModuleId | null;
    targetState: boolean;
    moduleName: string;
  }>({
    isOpen: false,
    moduleId: null,
    targetState: false,
    moduleName: "",
  });

  const getModuleIcon = (id: string) => {
    switch (id) {
      case "loa":
        return <CalendarOff className="w-5 h-5 text-brand-orange" />;
      case "punishments":
        return <ShieldAlert className="w-5 h-5 text-rose-400" />;
      case "refunds":
        return <Receipt className="w-5 h-5 text-emerald-400" />;
      case "suggestions":
        return <Lightbulb className="w-5 h-5 text-amber-400" />;
      case "referrals":
        return <Users className="w-5 h-5 text-blue-400" />;
      case "reminders":
        return <Clock className="w-5 h-5 text-purple-400" />;
      case "stickies":
        return <Pin className="w-5 h-5 text-indigo-400" />;
      case "admin-chat":
        return <MessageSquare className="w-5 h-5 text-brand-orange" />;
      default:
        return <Activity className="w-5 h-5 text-slate-400" />;
    }
  };

  const filteredModules = modules.filter((m) => {
    if (filter === "staff") return m.staffOnly;
    if (filter === "community") return !m.staffOnly && m.category === "community";
    if (filter === "utility") return m.category === "utility";
    return true;
  });

  const handleToggleClick = (mod: ModuleDefinition, newState: boolean) => {
    // If disabling a core module, request confirmation
    if (!newState) {
      setConfirmModal({
        isOpen: true,
        moduleId: mod.id,
        targetState: newState,
        moduleName: mod.name,
      });
    } else {
      onToggleModule(mod.id, newState);
    }
  };

  const handleConfirmToggle = async () => {
    if (confirmModal.moduleId) {
      await onToggleModule(confirmModal.moduleId, confirmModal.targetState);
    }
    setConfirmModal({ isOpen: false, moduleId: null, targetState: false, moduleName: "" });
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <Boxes className="w-6 h-6 text-brand-orange" />
            DamoBot Modules
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Configure, enable, or disable any feature module. Changes apply immediately to the bot.
          </p>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex items-center p-1 rounded-xl border border-dark-750 bg-dark-850 self-start">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === "all" ? "bg-brand-orange text-dark-950 font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            All ({modules.length})
          </button>
          <button
            onClick={() => setFilter("staff")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === "staff" ? "bg-brand-orange text-dark-950 font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Staff Only
          </button>
          <button
            onClick={() => setFilter("community")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === "community" ? "bg-brand-orange text-dark-950 font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Community
          </button>
          <button
            onClick={() => setFilter("utility")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === "utility" ? "bg-brand-orange text-dark-950 font-bold" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Utility
          </button>
        </div>
      </div>

      {/* Module Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredModules.map((mod) => (
          <SpotlightCard
            key={mod.id}
            className="flex flex-col justify-between p-6 hover:border-dark-600 transition-all duration-200"
          >
            <div className="space-y-4">
              {/* Header inside card */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-dark-800 border border-dark-750">
                    {getModuleIcon(mod.id)}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-100 text-sm">{mod.name}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] font-mono text-slate-400">{mod.version}</span>
                      {mod.staffOnly ? (
                        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-dark-750 text-slate-400 font-mono">
                          Staff
                        </span>
                      ) : (
                        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-brand-orangeMuted text-brand-orange font-mono">
                          Public
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Direct Toggle Switch */}
                <div className="flex items-center gap-2">
                  <ToggleSwitch
                    checked={mod.enabled}
                    onChange={(checked) => handleToggleClick(mod, checked)}
                    size="sm"
                  />
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed min-h-[48px]">
                {mod.description}
              </p>

              {/* Module Stats if any */}
              {mod.stats && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-dark-750/70 text-xs">
                  {mod.stats.map((stat, idx) => (
                    <div key={idx} className="bg-dark-900/60 p-2 rounded-lg border border-dark-750/50">
                      <div className="text-[10px] text-slate-400">{stat.label}</div>
                      <div className="font-semibold text-slate-200 mt-0.5">{stat.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom Action Footer */}
            <div className="mt-6 pt-4 border-t border-dark-750 flex items-center justify-between">
              <Badge variant={mod.enabled ? "success" : "danger"} dot>
                {mod.enabled ? "Enabled" : "Disabled"}
              </Badge>

              {mod.configurable ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Sliders className="w-3.5 h-3.5" />}
                  onClick={() => navigate(`/modules/${mod.id}`)}
                >
                  Configure
                </Button>
              ) : (
                <span className="text-[11px] text-slate-400 italic">No custom settings</span>
              )}
            </div>
          </SpotlightCard>
        ))}
      </div>

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={`Disable ${confirmModal.moduleName}?`}
        message="Disabling this module will immediately deactivate its Discord slash commands, interactive buttons, and scheduled cron jobs. You can re-enable it at any time."
        confirmLabel="Disable Module"
        danger={true}
        onConfirm={handleConfirmToggle}
        onCancel={() =>
          setConfirmModal({ isOpen: false, moduleId: null, targetState: false, moduleName: "" })
        }
      />
    </div>
  );
};
