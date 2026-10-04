import React, { useState } from "react";
import { Shield, Hash, Search } from "lucide-react";
import { SpotlightCard } from "../components/ui/SpotlightCard";
import { DiscordRole, DiscordChannel } from "../types/discord";

interface DiscordSettingsPageProps {
  roles: DiscordRole[];
  channels: DiscordChannel[];
}

export const DiscordSettingsPage: React.FC<DiscordSettingsPageProps> = ({
  roles,
  channels,
}) => {
  const [roleSearch, setRoleSearch] = useState("");
  const [channelSearch, setChannelSearch] = useState("");

  const filteredRoles = roles.filter((r) =>
    r.name.toLowerCase().includes(roleSearch.toLowerCase()) || r.id.includes(roleSearch)
  );

  const filteredChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(channelSearch.toLowerCase()) || c.id.includes(channelSearch)
  );

  const getRoleHexColor = (color: number) => {
    if (!color) return "#94A3B8";
    return `#${color.toString(16).padStart(6, "0")}`;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
          <Shield className="w-6 h-6 text-discord-blurple" />
          Discord Integration & Resource Mapping
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Server roles, permission hierarchy, and text channels discovered from the Vital RP guild.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Roles Panel */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <Shield className="w-4 h-4 text-discord-blurple" />
              Guild Roles ({filteredRoles.length})
            </h2>
            <div className="relative w-48">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={roleSearch}
                onChange={(e) => setRoleSearch(e.target.value)}
                placeholder="Search roles..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-dark-800 border border-dark-700 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-brand-orange"
              />
            </div>
          </div>

          <SpotlightCard className="p-2 max-h-[500px] overflow-y-auto space-y-1">
            {filteredRoles.map((role) => (
              <div
                key={role.id}
                className="flex items-center justify-between p-2.5 rounded-lg hover:bg-dark-800/80 transition-colors text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getRoleHexColor(role.color) }}
                  />
                  <span className="font-semibold text-slate-200">{role.name}</span>
                </div>
                <span className="font-mono text-[11px] text-slate-400 bg-dark-900 px-2 py-0.5 rounded border border-dark-750">
                  {role.id}
                </span>
              </div>
            ))}
          </SpotlightCard>
        </div>

        {/* Channels Panel */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <Hash className="w-4 h-4 text-brand-orange" />
              Guild Channels ({filteredChannels.length})
            </h2>
            <div className="relative w-48">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder="Search channels..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-dark-800 border border-dark-700 text-xs text-slate-200 placeholder-slate-400 focus:outline-none focus:border-brand-orange"
              />
            </div>
          </div>

          <SpotlightCard className="p-2 max-h-[500px] overflow-y-auto space-y-1">
            {filteredChannels.map((channel) => (
              <div
                key={channel.id}
                className="flex items-center justify-between p-2.5 rounded-lg hover:bg-dark-800/80 transition-colors text-xs"
              >
                <div className="flex items-center gap-2">
                  <Hash className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-semibold text-slate-200">{channel.name}</span>
                </div>
                <span className="font-mono text-[11px] text-slate-400 bg-dark-900 px-2 py-0.5 rounded border border-dark-750">
                  {channel.id}
                </span>
              </div>
            ))}
          </SpotlightCard>
        </div>
      </div>
    </div>
  );
};
