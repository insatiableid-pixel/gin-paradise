/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./lib/store";

const Layout = lazy(() =>
  import("./components/Layout").then(({ Layout }) => ({ default: Layout })),
);
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then(({ Dashboard }) => ({ default: Dashboard })),
);
const GameRoom = lazy(() =>
  import("./pages/GameRoom").then(({ GameRoom }) => ({ default: GameRoom })),
);
const MultiplayerRoom = lazy(() =>
  import("./pages/MultiplayerRoom").then(({ MultiplayerRoom }) => ({ default: MultiplayerRoom })),
);
const Leaderboard = lazy(() =>
  import("./pages/Leaderboard").then(({ Leaderboard }) => ({ default: Leaderboard })),
);
const Profile = lazy(() => import("./pages/Profile").then(({ Profile }) => ({ default: Profile })));
const Analysis = lazy(() =>
  import("./pages/Analysis").then(({ Analysis }) => ({ default: Analysis })),
);
const Replays = lazy(() => import("./pages/Replays").then(({ Replays }) => ({ default: Replays })));
const Wallet = lazy(() => import("./pages/Wallet").then(({ Wallet }) => ({ default: Wallet })));
const Tournaments = lazy(() =>
  import("./pages/Tournaments").then(({ Tournaments }) => ({ default: Tournaments })),
);
const AdminDashboard = lazy(() =>
  import("./pages/AdminDashboard").then(({ AdminDashboard }) => ({ default: AdminDashboard })),
);
const Training = lazy(() =>
  import("./pages/Training").then(({ Training }) => ({ default: Training })),
);
const Fairness = lazy(() =>
  import("./pages/Fairness").then(({ Fairness }) => ({ default: Fairness })),
);
const Cosmetics = lazy(() =>
  import("./pages/Cosmetics").then(({ Cosmetics }) => ({ default: Cosmetics })),
);
const Premium = lazy(() => import("./pages/Premium").then(({ Premium }) => ({ default: Premium })));
const PublicPlayerProfile = lazy(() =>
  import("./pages/PublicPlayerProfile").then(({ PublicPlayerProfile }) => ({
    default: PublicPlayerProfile,
  })),
);
const SocialHub = lazy(() =>
  import("./pages/SocialHub").then(({ SocialHub }) => ({ default: SocialHub })),
);
const FeaturedMatches = lazy(() =>
  import("./pages/FeaturedMatches").then(({ FeaturedMatches }) => ({ default: FeaturedMatches })),
);
const DailyHub = lazy(() =>
  import("./pages/DailyHub").then(({ DailyHub }) => ({ default: DailyHub })),
);
const Auth = lazy(() => import("./pages/Auth").then(({ Auth }) => ({ default: Auth })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { sessionId } = useAuthStore();
  if (!sessionId) return <Navigate to="/auth" />;
  return <>{children}</>;
}

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a2e1e] text-emerald-100">
      Loading...
    </div>
  );
}

export default function App() {
  const { sessionId, setUser, logout } = useAuthStore();

  useEffect(() => {
    if (sessionId) {
      fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${sessionId}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) setUser(data.user);
          else logout();
        })
        .catch(() => logout());
    }
  }, [sessionId, setUser, logout]);

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
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
          <Route
            path="/play"
            element={
              <ProtectedRoute>
                <GameRoom />
              </ProtectedRoute>
            }
          />
          <Route
            path="/play/multiplayer"
            element={
              <ProtectedRoute>
                <MultiplayerRoom />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
