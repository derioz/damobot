import React, { useState } from "react";
import { DiscordChannel } from "../../types/discord";
import { ChevronDown, Check, Hash, X } from "lucide-react";
import { cn } from "../../utils/cn";

interface ChannelSelectorProps {
  channels: DiscordChannel[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
}

export const ChannelSelector: React.FC<ChannelSelectorProps> = ({
  channels,
  value,
  onChange,
  disabled = false,
  placeholder = "Select a channel...",
  allowEmpty = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedChannel = channels.find((c) => c.id === value);

  return (
    <div className="relative w-full">
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={cn(
          "w-full h-[42px] px-3 py-1.5 rounded-lg border border-dark-700 bg-dark-850 hover:border-dark-600 cursor-pointer flex items-center justify-between gap-2 transition-colors",
          disabled && "opacity-40 cursor-not-allowed",
          isOpen && "ring-2 ring-brand-orange border-transparent"
        )}
      >
        <div className="flex items-center gap-2 flex-1 overflow-hidden">
          <Hash className="w-4 h-4 text-slate-400 flex-shrink-0" />
          {selectedChannel ? (
            <span className="text-sm font-medium text-slate-200 truncate">
              {selectedChannel.name}
            </span>
          ) : (
            <span className="text-sm text-slate-400">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {allowEmpty && value && !disabled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="text-slate-400 hover:text-slate-200 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown
            className={cn(
              "w-4 h-4 text-slate-400 transition-transform duration-200",
              isOpen && "rotate-180"
            )}
          />
        </div>
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1.5 z-30 rounded-xl border border-dark-700 bg-dark-900 shadow-2xl p-2 max-h-60 flex flex-col animate-slide-down">
            <div className="p-1 pb-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search channels..."
                className="w-full px-2.5 py-1.5 rounded-md bg-dark-800 border border-dark-750 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-brand-orange"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {allowEmpty && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left",
                    !value ? "bg-brand-orangeMuted text-brand-orange" : "text-slate-400 hover:bg-dark-800"
                  )}
                >
                  <span>(None / Server-wide)</span>
                  {!value && <Check className="w-3.5 h-3.5" />}
                </button>
              )}

              {filteredChannels.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  No matching channels found.
                </div>
              ) : (
                filteredChannels.map((channel) => {
                  const isSelected = value === channel.id;
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => {
                        onChange(channel.id);
                        setIsOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left",
                        isSelected
                          ? "bg-brand-orangeMuted text-brand-orange"
                          : "text-slate-300 hover:bg-dark-800"
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Hash className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="truncate">{channel.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-slate-400">
                          {channel.id}
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
