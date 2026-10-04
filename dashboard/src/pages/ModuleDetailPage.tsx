import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { SpotlightCard } from "../components/ui/SpotlightCard";
import { Button } from "../components/ui/Button";
import { ToggleSwitch } from "../components/ui/ToggleSwitch";
import { Badge } from "../components/ui/Badge";
import { RoleSelector } from "../components/discord/RoleSelector";
import { ChannelSelector } from "../components/discord/ChannelSelector";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { CategoryManager } from "../components/modules/CategoryManager";
import { ModuleDefinition, ModuleId } from "../types/modules";
import { DiscordRole, DiscordChannel } from "../types/discord";

interface ModuleDetailPageProps {
  modules: ModuleDefinition[];
  discordRoles: DiscordRole[];
  discordChannels: DiscordChannel[];
  onSaveSettings: (id: ModuleId, settings: Record<string, any>) => Promise<void>;
}

export const ModuleDetailPage: React.FC<ModuleDetailPageProps> = ({
  modules,
  discordRoles,
  discordChannels,
  onSaveSettings,
}) => {
  const { moduleId } = useParams<{ moduleId: string }>();
  const navigate = useNavigate();

  const moduleDef = modules.find((m) => m.id === moduleId);

  // Form state
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [initialData, setInitialData] = useState<Record<string, any>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // Populate initial state when module loads
  useEffect(() => {
    if (moduleDef) {
      const initial: Record<string, any> = {};
      moduleDef.settingsSchema.forEach((s) => {
        initial[s.key] = s.defaultValue;
      });
      setFormData(initial);
      setInitialData(JSON.parse(JSON.stringify(initial)));
      setHasUnsavedChanges(false);
    }
  }, [moduleDef]);

  // Track change dirty state
  const handleFieldChange = (key: string, value: any) => {
    const updated = { ...formData, [key]: value };
    setFormData(updated);
    setHasUnsavedChanges(JSON.stringify(updated) !== JSON.stringify(initialData));
    setSaveSuccess(false);
  };

  const handleReset = () => {
    setFormData(JSON.parse(JSON.stringify(initialData)));
    setHasUnsavedChanges(false);
  };

  const handleSave = async () => {
    if (!moduleDef) return;
    setSaving(true);
    try {
      await onSaveSettings(moduleDef.id, formData);
      setInitialData(JSON.parse(JSON.stringify(formData)));
      setHasUnsavedChanges(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (err) {
      console.error("Save error", err);
    } finally {
      setSaving(false);
    }
  };

  if (!moduleDef) {
    return (
      <div className="py-20 text-center space-y-4">
        <h2 className="text-xl font-bold text-slate-100">Module Not Found</h2>
        <p className="text-sm text-slate-400">
          The requested module &quot;{moduleId}&quot; does not exist.
        </p>
        <Button variant="secondary" onClick={() => navigate("/modules")}>
          Return to Modules
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Top Navigation & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <button
            onClick={() => navigate("/modules")}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 mb-2 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Modules
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">
              {moduleDef.name}
            </h1>
            <Badge variant={moduleDef.enabled ? "success" : "danger"} dot>
              {moduleDef.enabled ? "Active" : "Disabled"}
            </Badge>
            {moduleDef.staffOnly && (
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-dark-750 text-slate-400">
                Staff Only
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 max-w-2xl">{moduleDef.description}</p>
        </div>

        {/* Top Save button if changes exist */}
        {hasUnsavedChanges && (
          <div className="flex items-center gap-2 self-start">
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Reset
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              icon={<Save className="w-3.5 h-3.5" />}
              onClick={handleSave}
            >
              Save Changes
            </Button>
          </div>
        )}
      </div>

      {/* Save Success Alert */}
      {saveSuccess && (
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 flex items-center gap-3 text-sm animate-fade-in">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>Configuration saved successfully and updated live.</span>
        </div>
      )}

      {/* Settings Form Container */}
      <div className="space-y-6">
        {moduleDef.settingsSchema.length === 0 ? (
          <SpotlightCard className="py-12 text-center text-slate-400 text-sm">
            This module operates without dynamic parameters.
          </SpotlightCard>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {moduleDef.settingsSchema.map((field) => {
              const currentValue = formData[field.key];

              return (
                <SpotlightCard key={field.key} className="p-6 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-1 max-w-xl">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-bold text-slate-200">
                          {field.label}
                        </label>
                        {field.danger && (
                          <Badge variant="warning" className="text-[10px]">
                            High Impact
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        {field.description}
                      </p>
                      <div className="font-mono text-[10px] text-slate-400">
                        key: {field.key}
                      </div>
                    </div>

                    {/* Form Controls */}
                    <div className="w-full sm:w-80 flex-shrink-0">
                      {/* Boolean Toggle */}
                      {field.type === "boolean" && (
                        <div className="flex justify-end">
                          <ToggleSwitch
                            checked={Boolean(currentValue)}
                            onChange={(val) => handleFieldChange(field.key, val)}
                          />
                        </div>
                      )}

                      {/* Discord Channel Selector */}
                      {field.type === "discord_channel" && (
                        <ChannelSelector
                          channels={discordChannels}
                          value={currentValue || ""}
                          onChange={(val) => handleFieldChange(field.key, val)}
                          allowEmpty={true}
                        />
                      )}

                      {/* Single Discord Role */}
                      {field.type === "discord_role" && (
                        <RoleSelector
                          roles={discordRoles}
                          value={currentValue || ""}
                          onChange={(val) => handleFieldChange(field.key, val)}
                        />
                      )}

                      {/* Multiple Discord Roles */}
                      {field.type === "discord_roles" && (
                        <RoleSelector
                          roles={discordRoles}
                          value={currentValue || []}
                          onChange={(val) => handleFieldChange(field.key, val)}
                          multiple={true}
                        />
                      )}

                      {/* Number Input */}
                      {field.type === "number" && (
                        <input
                          type="number"
                          value={currentValue ?? 0}
                          onChange={(e) =>
                            handleFieldChange(field.key, parseFloat(e.target.value))
                          }
                          className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-sm text-slate-200 focus:outline-none focus:border-brand-orange"
                        />
                      )}

                      {/* Short String Input */}
                      {field.type === "string" && (
                        <input
                          type="text"
                          value={currentValue || ""}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-sm text-slate-200 focus:outline-none focus:border-brand-orange"
                        />
                      )}

                      {/* Select Dropdown */}
                      {field.type === "select" && field.options && (
                        <select
                          value={currentValue || ""}
                          onChange={(e) => handleFieldChange(field.key, e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-sm text-slate-200 focus:outline-none focus:border-brand-orange"
                        >
                          {field.options.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Complex Editor: String Array (e.g. Admin Chat Responses) */}
                  {field.type === "string_array" && Array.isArray(currentValue) && (
                    <div className="pt-4 border-t border-dark-750/70 space-y-2">
                      <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 bg-dark-900 rounded-lg border border-dark-750">
                        {currentValue.map((item: string, idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-2 px-3 py-1.5 rounded bg-dark-850 border border-dark-750/60 text-xs text-slate-300"
                          >
                            <span className="truncate">&quot;{item}&quot;</span>
                            <button
                              onClick={() => {
                                const copy = [...currentValue];
                                copy.splice(idx, 1);
                                handleFieldChange(field.key, copy);
                              }}
                              className="text-slate-400 hover:text-rose-400 p-1"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Complex Editor: Dynamic Categories (Refunds & Suggestions) */}
                  {(field.type === "categories_refund" ||
                    field.type === "categories_suggestion") &&
                    Array.isArray(currentValue) && (
                      <div className="pt-4 border-t border-dark-750/70">
                        <CategoryManager
                          categories={currentValue}
                          onChange={(cats) => handleFieldChange(field.key, cats)}
                          maxActiveCategories={24}
                        />
                      </div>
                    )}
                </SpotlightCard>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Unsaved Changes Bottom Bar */}
      {hasUnsavedChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-11/12 max-w-2xl rounded-2xl border border-brand-orange/40 bg-dark-900/95 backdrop-blur-md p-4 shadow-2xl flex items-center justify-between gap-4 animate-slide-down">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-orangeMuted text-brand-orange">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">
                Unsaved Changes Detected
              </div>
              <div className="text-xs text-slate-400">
                Save your modifications to apply them live.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Reset
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={saving}
              icon={<Save className="w-4 h-4" />}
              onClick={handleSave}
            >
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() =>
          setConfirmModal({
            isOpen: false,
            title: "",
            message: "",
            onConfirm: () => {},
          })
        }
      />
    </div>
  );
};
