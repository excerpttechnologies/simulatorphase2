"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AuthUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isReady: boolean;
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Remove any legacy persisted auth flags on every app load */
function purgePersistedAuth() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("isLoggedIn");
    sessionStorage.removeItem("isLoggedIn");
    localStorage.removeItem("smsim_auth");
    sessionStorage.removeItem("smsim_auth");
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    purgePersistedAuth();
    setIsReady(true);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();

      if (!res.ok) {
        return {
          ok: false as const,
          message: json.message || "Invalid username or password",
        };
      }

      if (!json.token || !json.user) {
        return { ok: false as const, message: "Invalid server response" };
      }

      setToken(json.token);
      setUser(json.user);
      return { ok: true as const };
    } catch {
      return { ok: false as const, message: "Network error. Please check your connection." };
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    purgePersistedAuth();
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!token && !!user,
      isReady,
      login,
      logout,
    }),
    [user, token, isReady, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
