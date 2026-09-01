"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const T = {
  border: "rgba(0,80,180,0.18)",
  accent: "#0055cc",
  textDim: "#6a8aaa",
};

function userInitial(user: { username?: string; name?: string; email?: string }): string {
  const src = user.username || user.name || user.email || "?";
  return src.charAt(0).toUpperCase();
}

export function ProfileMenu() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, close]);

  const handleLogout = () => {
    close();
    logout();
    router.replace("/login");
  };

  if (!user) return null;

  const initial = userInitial(user);

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", flexShrink: 0, marginLeft: 4 }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: `2px solid ${open ? "rgba(0,85,204,0.55)" : T.border}`,
          background: open
            ? "linear-gradient(145deg, rgba(0,85,204,0.12), rgba(0,180,255,0.08))"
            : "linear-gradient(145deg, #f0f6fc, #e8f0fa)",
          color: T.accent,
          fontSize: 13,
          fontWeight: 800,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: open
            ? "0 0 0 3px rgba(0,100,200,0.12), 0 2px 10px rgba(0,80,180,0.15)"
            : "0 1px 4px rgba(0,80,180,0.10)",
          transition: "border-color 0.18s, box-shadow 0.18s, background 0.18s",
          outline: "none",
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.borderColor = "rgba(0,85,204,0.4)";
            e.currentTarget.style.boxShadow = "0 0 0 2px rgba(0,100,200,0.08), 0 2px 8px rgba(0,80,180,0.12)";
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.borderColor = T.border;
            e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,80,180,0.10)";
          }
        }}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: 200,
            background: "rgba(255,255,255,0.98)",
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,40,100,0.18), 0 0 0 1px rgba(0,100,200,0.06)",
            padding: "10px 0 6px",
            zIndex: 250,
            pointerEvents: "auto",
          }}
          className="profile-menu-dropdown"
        >
          <div style={{ padding: "4px 14px 10px" }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#1a3050",
                letterSpacing: 0.3,
              }}
            >
              {user.username}
            </div>
            {user.email && (
              <div
                style={{
                  fontSize: 10,
                  color: T.textDim,
                  marginTop: 3,
                  letterSpacing: 0.2,
                  wordBreak: "break-all",
                }}
              >
                {user.email}
              </div>
            )}
            {user.name && user.name !== user.username && (
              <div style={{ fontSize: 9, color: T.textDim, marginTop: 2 }}>
                {user.name}
              </div>
            )}
          </div>

          <div
            style={{
              height: 1,
              margin: "0 10px 6px",
              background: T.border,
            }}
          />

          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "calc(100% - 12px)",
              margin: "0 6px",
              padding: "8px 10px",
              border: "none",
              borderRadius: 6,
              background: "transparent",
              color: "#cc3344",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.8,
              cursor: "pointer",
              textAlign: "left",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(204,51,68,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Logout
          </button>
        </div>
      )}

    </div>
  );
}
