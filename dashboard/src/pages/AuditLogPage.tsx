import React, { useState } from "react";
import { FileText, Search, User, Filter, ArrowRight } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { AuditLogEntry } from "../types/audit";

interface AuditLogPageProps {
  logs: AuditLogEntry[];
}

export const AuditLogPage: React.FC<AuditLogPageProps> = ({ logs }) => {
  const [search, setSearch] = useState("");
  const [selectedModule, setSelectedModule] = useState<string>("all");

  const modulesInLogs = Array.from(new Set(logs.map((l) => l.moduleName)));

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.userName.toLowerCase().includes(search.toLowerCase()) ||
      log.moduleName.toLowerCase().includes(search.toLowerCase()) ||
      log.key.toLowerCase().includes(search.toLowerCase());

    const matchesModule =
      selectedModule === "all" || log.moduleName === selectedModule;

    return matchesSearch && matchesModule;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
          <FileText className="w-6 h-6 text-brand-orange" />
          Configuration Audit Trail
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Historical record of every setting, feature toggle, and permission changed across DamoBot.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl border border-dark-750 bg-dark-850">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by admin, module, or key..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-brand-orange"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            className="px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-xs text-slate-200 focus:outline-none focus:border-brand-orange"
          >
            <option value="all">All Modules</option>
            {modulesInLogs.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="rounded-xl border border-dark-750 bg-dark-850 overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400">
            No audit records found matching your filters.
          </div>
        ) : (
          <div className="divide-y divide-dark-750">
            {filteredLogs.map((entry) => (
              <div
                key={entry.id}
                className="p-4 hover:bg-dark-800/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-dark-750 flex items-center justify-center text-slate-300 font-bold flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-200">{entry.userName}</span>
                      <span className="text-[10px] font-mono text-slate-400">
                        ({entry.userId})
                      </span>
                      <Badge variant="brand" className="text-[10px]">
                        {entry.moduleName}
                      </Badge>
                    </div>
                    <div className="mt-1 text-slate-400 flex items-center gap-2">
                      <span>Changed</span>
                      <code className="px-1.5 py-0.5 rounded bg-dark-900 border border-dark-750 font-mono text-slate-200">
                        {entry.key}
                      </code>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 pl-11 md:pl-0">
                  <div className="flex items-center gap-2 font-mono text-[11px] bg-dark-900 px-3 py-1.5 rounded-lg border border-dark-750">
                    <span className="text-rose-400 line-through truncate max-w-[120px]">
                      {String(entry.oldValue)}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-emerald-400 font-semibold truncate max-w-[120px]">
                      {String(entry.newValue)}
                    </span>
                  </div>

                  <span className="text-[10px] text-slate-400 whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
