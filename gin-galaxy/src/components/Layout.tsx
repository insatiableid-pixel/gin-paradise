import React from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Trophy, User, Play, Activity, LogOut, History, Coins, Shield, GraduationCap, ShieldCheck, Package, Crown, Swords, Tv, CalendarCheck } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useAuthStore } from "@/src/lib/store";
import { AchievementToast } from "./AchievementToast";

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, sessionId } = useAuthStore();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    logout();
    navigate("/auth");
  };

  // Primary navigation — the core loop surfaces
  const primaryNav = [
    { name: "Play", path: "/", icon: Play },
    { name: "Daily", path: "/daily", icon: CalendarCheck },
    { name: "Wallet", path: "/wallet", icon: Coins },
    { name: "Premium", path: "/premium", icon: Crown },
  ];

  // Secondary navigation — valuable but not the primary loop
  const secondaryNav = [
    { name: "Leaderboard", path: "/leaderboard", icon: Trophy },
    { name: "Training", path: "/training", icon: GraduationCap },
    { name: "Analysis", path: "/analysis", icon: Activity },
    { name: "Replays", path: "/replays", icon: History },
    { name: "Trust Shield", path: "/fairness", icon: ShieldCheck },
    { name: "Cosmetics", path: "/cosmetics", icon: Package },
    { name: "Social", path: "/social", icon: Swords },
    { name: "Live", path: "/live", icon: Tv },
    { name: "Profile", path: "/profile", icon: User },
    { name: "Tournaments", path: "/tournaments", icon: Trophy },
    ...(user?.is_admin ? [{ name: "Admin", path: "/admin", icon: Shield }] : []),
  ];

  const allNav = [...primaryNav, ...secondaryNav];

  // Mobile bottom bar — only the most important 5 items
  const mobileNav = [
    { name: "Play", path: "/", icon: Play },
    { name: "Daily", path: "/daily", icon: CalendarCheck },
    { name: "Wallet", path: "/wallet", icon: Coins },
    { name: "Premium", path: "/premium", icon: Crown },
    { name: "Profile", path: "/profile", icon: User },
  ];

  return (
    <div className="min-h-screen text-zinc-50 font-sans selection:bg-amber-500/30" style={{ background: 'linear-gradient(180deg, #0a2e1e 0%, #0d3828 30%, #0f3d2d 60%, #0a2e1e 100%)' }}>
      {/* Subtle tropical texture overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%270 0 256 256%27 xmlns=%27http://www.w3.org/2000/svg%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%274%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27100%25%27 height=%27100%25%27 filter=%27url(%23n)%27/%3E%3C/svg%3E")', backgroundSize: '128px 128px' }} />

      {/* Top Navigation */}
      <header className="sticky top-0 z-50 w-full border-b border-emerald-800/40 bg-[#0a2e1e]/90 backdrop-blur supports-[backdrop-filter]:bg-[#0a2e1e]/70">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-6 md:gap-10">
            <Link to="/" className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white shadow-lg shadow-amber-500/20" style={{ background: 'linear-gradient(135deg, #d4a843, #b8860b)' }}>
                🌴
              </div>
              <span className="inline-block font-bold tracking-tight text-xl text-amber-100" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>Gin Paradise</span>
            </Link>
            <nav className="hidden md:flex gap-6">
              {allNav.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center text-sm font-medium transition-colors hover:text-amber-200",
                    location.pathname === item.path ? "text-amber-200" : "text-emerald-300/60"
                  )}
                >
                  {item.name}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-900/50 border border-emerald-700/40">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-emerald-200/80">1,248 Online</span>
            </div>
            <button onClick={handleLogout} className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-900/50 hover:bg-emerald-800/60 border border-emerald-700/30 transition-colors" title="Logout">
              <LogOut className="w-4 h-4 text-emerald-300/60" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full border border-amber-600/50 cursor-pointer flex items-center justify-center text-xs font-bold text-amber-200" style={{ background: 'linear-gradient(135deg, #d4a843, #b8860b)' }}>
                {user?.username?.[0]?.toUpperCase()}
              </div>
              <span className="hidden sm:inline-block text-sm font-medium text-emerald-200/80">{user?.username}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Outlet />
      </main>

      {/* Mobile Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-emerald-800/40 bg-[#0a2e1e]/90 backdrop-blur md:hidden">
        {mobileNav.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full space-y-1",
                isActive ? "text-amber-400" : "text-emerald-400/50 hover:text-emerald-300"
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          );
        })}
      </div>

      {/* Achievement unlock toast */}
      <AchievementToast />
    </div>
  );
}
