import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { SearchModal } from "../ui/SearchModal";
import { ModuleDefinition } from "../../types/modules";
import { DashboardAuthUser } from "../../types/discord";
import { BotStatusResponse } from "../../types/audit";

interface LayoutProps {
  user: DashboardAuthUser;
  modules: ModuleDefinition[];
  botStatus?: BotStatusResponse;
  onLogout: () => void;
}

export const Layout: React.FC<LayoutProps> = ({
  user,
  modules,
  botStatus,
  onLogout,
}) => {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-dark-950 text-slate-100 font-sans">
      {/* Collapsible Sidebar */}
      <Sidebar user={user} onLogout={onLogout} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        <Header onOpenSearch={() => setSearchOpen(true)} botStatus={botStatus} />

        <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-gradient-to-b from-dark-900/40 to-dark-950">
          <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global Search Modal */}
      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        modules={modules}
      />
    </div>
  );
};
