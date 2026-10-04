import React, { useState } from "react";
import { DiscordRole } from "../../types/discord";
import { ChevronDown, Check, X } from "lucide-react";
import { cn } from "../../utils/cn";

interface RoleSelectorProps {
  roles: DiscordRole[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export const RoleSelector: React.FC<RoleSelectorProps> = ({
  roles,
  value,
  onChange,
  multiple = false,
  disabled = false,
  placeholder = "Select a Discord role...",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedIds = Array.isArray(value) ? value : value ? [value] : [];

  const filteredRoles = roles.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  const getRoleHexColor = (color: number) => {
    if (!color) return "#94A3B8";
    return `#${color.toString(16).padStart(6, "0")}`;
  };

  const toggleRole = (roleId: string) => {
    if (multiple) {
      if (selectedIds.includes(roleId)) {
        onChange(selectedIds.filter((id) => id !== roleId));
      } else {
        onChange([...selectedIds, roleId]);
      }
    } else {
      onChange(roleId);
      setIsOpen(false);
    }
  };

  const removeRole = (e: React.MouseEvent, roleId: string) => {
    e.stopPropagation();
    onChange(selectedIds.filter((id) => id !== roleId));
  };

  return (
    <div className="relative w-full">
      {/* Selector Trigger Button */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={cn(
          "w-full min-h-[42px] px-3 py-1.5 rounded-lg border border-dark-700 bg-dark-850 hover:border-dark-600 cursor-pointer flex items-center justify-between gap-2 transition-colors",
          disabled && "opacity-40 cursor-not-allowed",
          isOpen && "ring-2 ring-brand-orange border-transparent"
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5 flex-1 overflow-hidden">
          {selectedIds.length === 0 ? (
            <span className="text-sm text-slate-400">{placeholder}</span>
          ) : multiple ? (
            selectedIds.map((id) => {
              const role = roles.find((r) => r.id === id);
              if (!role) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-dark-800 border border-dark-700 text-xs font-medium text-slate-200"
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: getRoleHexColor(role.color) }}
                  />
                  <span>{role.name}</span>
                  {!disabled && (
                    <button
                      onClick={(e) => removeRole(e, id)}
                      className="text-slate-400 hover:text-slate-200"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              );
            })
          ) : (
            (() => {
              const role = roles.find((r) => r.id === selectedIds[0]);
              if (!role) return <span className="text-sm text-slate-400">Unknown Role</span>;
              return (
                <div className="flex items-center gap-2 text-sm text-slate-200">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: getRoleHexColor(role.color) }}
                  />
                  <span className="font-medium">{role.name}</span>
                </div>
              );
            })()
          )}
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-slate-400 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1.5 z-30 rounded-xl border border-dark-700 bg-dark-900 shadow-2xl p-2 max-h-60 flex flex-col animate-slide-down">
            <div className="p-1 pb-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search roles..."
                className="w-full px-2.5 py-1.5 rounded-md bg-dark-800 border border-dark-750 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-brand-orange"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {filteredRoles.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  No matching roles found.
                </div>
              ) : (
                filteredRoles.map((role) => {
                  const isSelected = selectedIds.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRole(role.id)}
                      className={cn(
                        "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left",
                        isSelected
                          ? "bg-brand-orangeMuted text-brand-orange"
                          : "text-slate-300 hover:bg-dark-800"
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getRoleHexColor(role.color) }}
                        />
                        <span className="truncate">{role.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-slate-400">
                          {role.id}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
