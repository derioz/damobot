import React from "react";
import { Shield, Bot, ArrowRight, Lock } from "lucide-react";
import { Button } from "../components/ui/Button";

interface LoginPageProps {
  onLoginWithDiscord: () => void;
  onDemoLogin: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginWithDiscord,
  onDemoLogin,
}) => {
  return (
    <div className="min-h-screen w-screen flex items-center justify-center p-4 bg-dark-950 text-slate-100 font-sans relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-brand-orange/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] bg-discord-blurple/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-dark-750 bg-dark-900/90 backdrop-blur-xl p-8 shadow-2xl space-y-6">
        {/* Brand Icon & Heading */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-orange to-amber-600 p-[1px] shadow-lg shadow-brand-orange/20">
            <div className="w-full h-full bg-dark-900 rounded-[15px] flex items-center justify-center">
              <Bot className="w-8 h-8 text-brand-orange" />
            </div>
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">
              DamoBot Control Panel
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Vital RP Discord Bot Management Center
            </p>
          </div>
        </div>

        {/* Security Notice */}
        <div className="p-3.5 rounded-xl border border-dark-750 bg-dark-850/80 text-xs text-slate-400 space-y-1.5">
          <div className="flex items-center gap-1.5 font-semibold text-slate-200">
            <Lock className="w-3.5 h-3.5 text-brand-orange" />
            Protected Administrator Access
          </div>
          <p className="leading-relaxed">
            Authentication is verified through Discord OAuth2. Only members of the{" "}
            <span className="text-slate-200 font-medium">Vital RP Discord Server</span> with
            approved staff roles can view or modify bot configurations.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <Button
            variant="discord"
            size="lg"
            className="w-full"
            icon={<Shield className="w-5 h-5" />}
            onClick={onLoginWithDiscord}
          >
            Login with Discord
          </Button>

          <Button
            variant="secondary"
            size="md"
            className="w-full"
            icon={<ArrowRight className="w-4 h-4" />}
            onClick={onDemoLogin}
          >
            Explore Dashboard (Local Demo)
          </Button>
        </div>

        {/* Footer info */}
        <div className="text-center text-[11px] text-slate-400">
          DamoBot v0.9.90 • Powered by Cloudflare Workers
        </div>
      </div>
    </div>
  );
};
