import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Boxes,
  ShieldAlert,
  CalendarOff,
  Receipt,
  Lightbulb,
  Users,
  Clock,
  Pin,
  MessageSquare,
  Shield,
  FileText,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Bot,
} from "lucide-react";
import { cn } from "../../utils/cn";
import { DashboardAuthUser } from "../../types/discord";

interface SidebarProps {
  user: DashboardAuthUser;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ user, onLogout }) => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  const moduleNavItems = [
    { to: "/modules/loa", label: "LOA Center", icon: CalendarOff, staffOnly: true },
    { to: "/modules/punishments", label: "Punishments", icon: ShieldAlert, staffOnly: true },
    { to: "/modules/refunds", label: "Refund Center", icon: Receipt, staffOnly: true },
    { to: "/modules/suggestions", label: "Suggestions", icon: Lightbulb, staffOnly: false },
    { to: "/modules/referrals", label: "Referrals", icon: Users, staffOnly: false },
    { to: "/modules/reminders", label: "Reminders", icon: Clock, staffOnly: true },
    { to: "/modules/stickies", label: "Sticky Messages", icon: Pin, staffOnly: true },
    { to: "/modules/admin-chat", label: "Admin Chat", icon: MessageSquare, staffOnly: true },
  ];

  return (
    <aside
      className={cn(
        "relative flex flex-col h-screen border-r border-dark-750 bg-dark-900 transition-all duration-300 z-30 flex-shrink-0 select-none",
        collapsed ? "w-20" : "w-64"
      )}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between p-4 border-b border-dark-750 h-16">
        <div
          onClick={() => navigate("/")}
          className="flex items-center gap-3 cursor-pointer overflow-hidden"
        >
          <div className="relative flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-brand-orange to-amber-600 p-[1px] shadow-lg shadow-brand-orange/15">
            <div className="w-full h-full bg-dark-900 rounded-[11px] flex items-center justify-center">
              <img
                src="https://r2.fivemanage.com/image/4sIiNuE1Vmvn.png"
                alt="DamoBot"
                className="w-6 h-6 object-contain"
                onError={(e) => {
                  // Fallback icon if image fails
                  e.currentTarget.style.display = "none";
                }}
              />
              <Bot className="w-5 h-5 text-brand-orange" />
            </div>
          </div>
          {!collapsed && (
            <div className="truncate">
              <div className="font-bold text-sm tracking-wide text-slate-100 flex items-center gap-1.5">
                DamoBot
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-brand-orange/15 text-brand-orange font-mono">
                  v0.9
                </span>
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                Vital RP Admin
              </div>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-dark-800 transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* Main Section */}
        <div className="space-y-1">
          {!collapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3">
              Overview
            </span>
          )}
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-orange text-dark-950 font-semibold shadow-sm shadow-brand-orange/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-dark-800"
              )
            }
          >
            <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Dashboard</span>}
          </NavLink>
          <NavLink
            to="/modules"
            end
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-orange text-dark-950 font-semibold shadow-sm shadow-brand-orange/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-dark-800"
              )
            }
          >
            <Boxes className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>All Modules</span>}
          </NavLink>
        </div>

        {/* Feature Modules Section */}
        <div className="space-y-1">
          {!collapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3">
              Feature Modules
            </span>
          )}
          {moduleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors group",
                    isActive
                      ? "bg-dark-800 text-brand-orange border border-dark-700"
                      : "text-slate-400 hover:text-slate-200 hover:bg-dark-850"
                  )
                }
                title={collapsed ? item.label : undefined}
              >
                <div className="flex items-center gap-3 truncate">
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </div>
                {!collapsed && item.staffOnly && (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-dark-750 text-slate-400 font-mono">
                    Staff
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>

        {/* System & Discord Section */}
        <div className="space-y-1">
          {!collapsed && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3">
              System & Discord
            </span>
          )}
          <NavLink
            to="/discord"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-dark-800 text-brand-orange border border-dark-700"
                  : "text-slate-400 hover:text-slate-200 hover:bg-dark-850"
              )
            }
          >
            <Shield className="w-4 h-4 flex-shrink-0 text-discord-blurple" />
            {!collapsed && <span>Discord Config</span>}
          </NavLink>
          <NavLink
            to="/audit"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-dark-800 text-brand-orange border border-dark-700"
                  : "text-slate-400 hover:text-slate-200 hover:bg-dark-850"
              )
            }
          >
            <FileText className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>Audit Log</span>}
          </NavLink>
        </div>
      </div>

      {/* User Footer */}
      <div className="p-3 border-t border-dark-750 bg-dark-950/60">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="w-8 h-8 rounded-full border border-dark-700 object-cover flex-shrink-0"
              onError={(e) => {
                e.currentTarget.src = "https://cdn.discordapp.com/embed/avatars/0.png";
              }}
            />
            {!collapsed && (
              <div className="truncate">
                <div className="text-xs font-semibold text-slate-200 truncate">
                  {user.displayName}
                </div>
                <div className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  {user.roleName}
                </div>
              </div>
            )}
          </div>

          {!collapsed ? (
            <button
              onClick={onLogout}
              title="Logout"
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-dark-800 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
};
