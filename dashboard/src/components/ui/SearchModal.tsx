import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, ArrowRight, Sliders, Shield, Hash } from "lucide-react";
import { ModuleDefinition } from "../../types/modules";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  modules: ModuleDefinition[];
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  modules,
}) => {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery("");
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const normalizedQuery = query.toLowerCase().trim();

  // Search results:
  // 1. Modules
  const matchedModules = modules.filter(
    (m) =>
      m.name.toLowerCase().includes(normalizedQuery) ||
      m.description.toLowerCase().includes(normalizedQuery) ||
      m.id.toLowerCase().includes(normalizedQuery)
  );

  // 2. Settings inside modules
  const matchedSettings: {
    module: ModuleDefinition;
    key: string;
    label: string;
    description: string;
  }[] = [];

  if (normalizedQuery.length > 1) {
    modules.forEach((mod) => {
      mod.settingsSchema.forEach((setting) => {
        if (
          setting.label.toLowerCase().includes(normalizedQuery) ||
          setting.key.toLowerCase().includes(normalizedQuery) ||
          setting.description.toLowerCase().includes(normalizedQuery)
        ) {
          matchedSettings.push({
            module: mod,
            key: setting.key,
            label: setting.label,
            description: setting.description,
          });
        }
      });
    });
  }

  const handleSelectModule = (id: string) => {
    navigate(`/modules/${id}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-dark-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl border border-dark-700 bg-dark-900 shadow-2xl overflow-hidden flex flex-col max-h-[75vh]">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-dark-750 gap-3">
          <Search className="w-5 h-5 text-brand-orange flex-shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules, settings, channels, or roles... (e.g. 'cooldown', 'referral', 'loa')"
            className="w-full bg-transparent text-slate-100 placeholder-slate-400 text-sm focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-mono text-slate-400 bg-dark-800 border border-dark-700 rounded">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Quick Jump Links if empty query */}
          {!query && (
            <div className="space-y-2 p-2">
              <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                Quick Navigation
              </span>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => {
                    navigate("/discord");
                    onClose();
                  }}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border border-dark-750 bg-dark-850 hover:bg-dark-800 text-left text-xs text-slate-200 transition-colors"
                >
                  <Shield className="w-4 h-4 text-discord-blurple" />
                  <div>
                    <div className="font-medium">Discord Roles</div>
                    <div className="text-[11px] text-slate-400">View server roles & mappings</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    navigate("/audit");
                    onClose();
                  }}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border border-dark-750 bg-dark-850 hover:bg-dark-800 text-left text-xs text-slate-200 transition-colors"
                >
                  <Sliders className="w-4 h-4 text-emerald-400" />
                  <div>
                    <div className="font-medium">Audit Log</div>
                    <div className="text-[11px] text-slate-400">Review configuration changes</div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Module Results */}
          {matchedModules.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase px-2">
                Modules ({matchedModules.length})
              </span>
              <div className="space-y-1 pt-1">
                {matchedModules.map((mod) => (
                  <button
                    key={mod.id}
                    onClick={() => handleSelectModule(mod.id)}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-dark-800 text-left transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded bg-dark-750 text-brand-orange group-hover:bg-brand-orange group-hover:text-dark-950 transition-colors">
                        <Sliders className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-200 group-hover:text-brand-orange transition-colors">
                          {mod.name}
                        </div>
                        <div className="text-xs text-slate-400 line-clamp-1">
                          {mod.description}
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-transform group-hover:translate-x-1" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Setting Key Matches */}
          {matchedSettings.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-dark-750">
              <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase px-2">
                Direct Settings ({matchedSettings.length})
              </span>
              <div className="space-y-1 pt-1">
                {matchedSettings.slice(0, 8).map((set) => (
                  <button
                    key={`${set.module.id}-${set.key}`}
                    onClick={() => handleSelectModule(set.module.id)}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-dark-800 text-left transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <Hash className="w-4 h-4 text-slate-400 group-hover:text-brand-orange" />
                      <div>
                        <div className="text-sm text-slate-200">
                          <span className="font-semibold text-brand-orange">
                            {set.module.name}
                          </span>{" "}
                          → {set.label}
                        </div>
                        <div className="text-xs text-slate-400 line-clamp-1">
                          {set.description}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 bg-dark-850 px-2 py-0.5 rounded border border-dark-750">
                      {set.key}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {query && matchedModules.length === 0 && matchedSettings.length === 0 && (
            <div className="py-12 text-center text-slate-400 text-sm">
              No results found matching &quot;{query}&quot;.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
