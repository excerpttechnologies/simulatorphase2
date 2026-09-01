"use client";



import { useRouter } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";



export function LogoutButton({ className = "" }: { className?: string }) {

  const router = useRouter();

  const { logout, user } = useAuth();



  const handleLogout = () => {

    logout();

    router.replace("/login");

  };



  return (

    <div className={`flex items-center gap-2 ${className}`}>

      {user && (

        <span

          className="hidden sm:inline text-xs text-slate-500 max-w-[120px] truncate"

          title={user.name}

        >

          {user.username}

        </span>

      )}

      <button

        type="button"

        onClick={handleLogout}

        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold

          text-slate-600 hover:text-red-600 hover:bg-red-50

          border border-slate-200 transition-colors"

        aria-label="Logout"

      >

        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">

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

  );

}

