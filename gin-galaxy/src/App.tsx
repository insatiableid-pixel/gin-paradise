/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { GameRoom } from "./pages/GameRoom";
import { MultiplayerRoom } from "./pages/MultiplayerRoom";
import { Leaderboard } from "./pages/Leaderboard";
import { Profile } from "./pages/Profile";
import { Analysis } from "./pages/Analysis";
import { Replays } from "./pages/Replays";
import { Wallet } from "./pages/Wallet";
import { Tournaments } from "./pages/Tournaments";
import { AdminDashboard } from "./pages/AdminDashboard";
import { Training } from "./pages/Training";
import { Fairness } from "./pages/Fairness";
import { Cosmetics } from "./pages/Cosmetics";
import { Premium } from "./pages/Premium";
import { PublicPlayerProfile } from "./pages/PublicPlayerProfile";
import { SocialHub } from "./pages/SocialHub";
import { FeaturedMatches } from "./pages/FeaturedMatches";
import { DailyHub } from "./pages/DailyHub";
import { Auth } from "./pages/Auth";
import { useAuthStore } from "./lib/store";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { sessionId } = useAuthStore();
  if (!sessionId) return <Navigate to="/auth" />;
  return <>{children}</>;
}

export default function App() {
  const { sessionId, setUser, logout } = useAuthStore();

  useEffect(() => {
    if (sessionId) {
      fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${sessionId}` }
      })
      .then(res => res.json())
      .then(data => {
        if (data.user) setUser(data.user);
        else logout();
      })
      .catch(() => logout());
    }
  }, [sessionId, setUser, logout]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="profile" element={<Profile />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="replays" element={<Replays />} />
          <Route path="training" element={<Training />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="tournaments" element={<Tournaments />} />
          <Route path="admin" element={<AdminDashboard />} />
          <Route path="fairness" element={<Fairness />} />
          <Route path="cosmetics" element={<Cosmetics />} />
          <Route path="premium" element={<Premium />} />
          <Route path="player/:username" element={<PublicPlayerProfile />} />
          <Route path="social" element={<SocialHub />} />
          <Route path="live" element={<FeaturedMatches />} />
          <Route path="daily" element={<DailyHub />} />
        </Route>
        <Route path="/play" element={<ProtectedRoute><GameRoom /></ProtectedRoute>} />
        <Route path="/play/multiplayer" element={<ProtectedRoute><MultiplayerRoom /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}

