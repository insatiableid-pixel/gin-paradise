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

const COOKIE_SESSION_MARKER = "cookie";

function readSessionMarker(): string | null {
  const stored = localStorage.getItem("sessionId");
  if (!stored) return null;
  // Migrate existing browser sessions away from reusable bearer persistence.
  if (stored !== COOKIE_SESSION_MARKER) {
    localStorage.removeItem("sessionId");
    return null;
  }
  return stored;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  sessionId: readSessionMarker(),
  setUser: (user) => {
    if (user) {
      localStorage.setItem("sessionId", COOKIE_SESSION_MARKER);
    } else {
      localStorage.removeItem("sessionId");
    }
    set({ user, sessionId: user ? COOKIE_SESSION_MARKER : null });
  },
  logout: () => {
    localStorage.removeItem("sessionId");
    set({ user: null, sessionId: null });
  },
}));
