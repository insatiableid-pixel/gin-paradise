import React from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Trophy, User, Settings, Play, Activity, LogOut, History, Coins, Shield, GraduationCap, ShieldCheck, Package, Crown, Swords, Tv, CalendarCheck } from "lucide-react";
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
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 w-full border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-6 md:gap-10">
            <Link to="/" className="flex items-center space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white shadow-lg shadow-indigo-500/20">
                G
              </div>
              <span className="inline-block font-bold tracking-tight text-xl">Gin Paradise</span>
            </Link>
            <nav className="hidden md:flex gap-6">
              {allNav.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center text-sm font-medium transition-colors hover:text-zinc-50",
                    location.pathname === item.path ? "text-zinc-50" : "text-zinc-400"
                  )}
                >
                  {item.name}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-medium text-zinc-300">1,248 Online</span>
            </div>
            <button onClick={handleLogout} className="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors" title="Logout">
              <LogOut className="w-4 h-4 text-zinc-400" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 border border-zinc-700 cursor-pointer flex items-center justify-center text-xs font-bold">
                {user?.username?.[0]?.toUpperCase()}
              </div>
              <span className="hidden sm:inline-block text-sm font-medium text-zinc-300">{user?.username}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Outlet />
      </main>

      {/* Mobile Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-zinc-800/60 bg-zinc-950/80 backdrop-blur md:hidden">
        {mobileNav.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full space-y-1",
                isActive ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300"
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
