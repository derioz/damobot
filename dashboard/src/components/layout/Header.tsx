import { Search, ShieldCheck, ExternalLink } from "lucide-react";
import { BotStatusResponse } from "../../types/audit";

interface HeaderProps {
  onOpenSearch: () => void;
  botStatus?: BotStatusResponse;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSearch, botStatus }) => {
  return (
    <header className="h-16 border-b border-dark-750 bg-dark-900/60 backdrop-blur-md px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
      {/* Search trigger bar */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-dark-750 bg-dark-850 hover:border-dark-700 text-slate-400 hover:text-slate-200 transition-colors w-72 md:w-96 text-left group"
      >
        <Search className="w-4 h-4 text-slate-400 group-hover:text-brand-orange transition-colors flex-shrink-0" />
        <span className="text-xs text-slate-400 truncate flex-1">
          Quick search settings, modules, channels...
        </span>
        <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-dark-800 border border-dark-700 rounded">
          ⌘K
        </kbd>
      </button>

      {/* Right status indicators */}
      <div className="flex items-center gap-3">
        {/* Guild pill */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full border border-dark-750 bg-dark-850 text-xs text-slate-300 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-discord-blurple" />
          <span>{botStatus?.guildName || "Vital RP"}</span>
        </div>

        {/* Live Bot status indicator */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-dark-750 bg-dark-850 text-xs font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-slate-200">Worker Live</span>
          <span className="text-[10px] font-mono text-slate-400">
            {botStatus?.version || "v0.9.90"}
          </span>
        </div>

        {/* External community link */}
        <a
          href="http://vitalrp.net"
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 hover:text-slate-200 p-2 rounded-lg hover:bg-dark-800 transition-colors"
          title="Visit Vital RP Website"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
};
