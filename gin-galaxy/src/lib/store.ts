import { create } from "zustand";

interface User {
  id: string;
  username: string;
  email: string;
  rating: number;
  is_admin?: boolean;
  plan?: "free" | "premium";
}

interface AuthState {
  user: User | null;
  sessionId: string | null;
  setUser: (user: User | null, sessionId?: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  sessionId: localStorage.getItem("sessionId"),
  setUser: (user, sessionId) => {
    if (sessionId) {
      localStorage.setItem("sessionId", sessionId);
    }
    set({ user, sessionId: sessionId || localStorage.getItem("sessionId") });
  },
  logout: () => {
    localStorage.removeItem("sessionId");
    set({ user: null, sessionId: null });
  },
}));
