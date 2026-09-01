"use client";



import { useState } from "react";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { useRouter, useSearchParams } from "next/navigation";

import Image from "next/image";

import { z } from "zod";

import { useAuth } from "@/contexts/AuthContext";



const loginSchema = z.object({

  username: z.string().min(1, "Username is required"),

  password: z.string().min(1, "Password is required"),

});



type LoginForm = z.infer<typeof loginSchema>;



export default function LoginClient() {

  const router = useRouter();

  const searchParams = useSearchParams();

  const from = searchParams.get("from") || "/";

  const { login } = useAuth();



  const [showPassword, setShowPassword] = useState(false);

  const [serverError, setServerError] = useState("");



  const {

    register,

    handleSubmit,

    formState: { errors, isSubmitting },

  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });



  const onSubmit = async (data: LoginForm) => {

    setServerError("");

    const result = await login(data.username, data.password);



    if (!result.ok) {

      setServerError(result.message);

      return;

    }



    const destination = !from || from === "/login" || from === "" ? "/" : from;

    router.replace(destination);

  };



  return (

    <div className="min-h-screen flex bg-slate-950">

      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-gradient-to-br from-blue-950 via-slate-900 to-slate-950 p-12 relative overflow-hidden">

        <div className="absolute inset-0 pointer-events-none">

          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />

          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl" />

        </div>



        <div className="relative z-10 text-center max-w-md">

          <div className="flex justify-center mb-8">

            <div className="w-24 h-24 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center backdrop-blur-sm overflow-hidden">

              <Image

                src="/1681701746297.png"

                alt="Semantic Skills Junction"

                width={80}

                height={80}

                className="object-contain"

                onError={(e) => {

                  (e.target as HTMLImageElement).style.display = "none";

                }}

              />

            </div>

          </div>



          <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">SMaRT Simulator</h1>

          <p className="text-blue-300 text-lg font-medium mb-2">Semiconductor Manufacturing Readiness Training</p>

          <p className="text-slate-400 text-sm leading-relaxed">300mm Photolithography · EFEM + Coater/Developer Track</p>



          <div className="mt-12 pt-8 border-t border-white/10">

            <p className="text-slate-500 text-xs">Powered by</p>

            <p className="text-slate-300 text-sm font-semibold mt-1">Semantic Skills Junction LLP</p>

          </div>

        </div>

      </div>



      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">

        <div className="w-full max-w-md">

          <div className="flex lg:hidden justify-center mb-8">

            <div className="w-16 h-16 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">

              <Image src="/1681701746297.png" alt="Logo" width={52} height={52} className="object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />

            </div>

          </div>



          <div className="mb-8">

            <h2 className="text-2xl font-bold text-white">Welcome back</h2>

            <p className="text-slate-400 mt-1 text-sm">Sign in to access the simulator</p>

          </div>



          {serverError && (

            <div className="mb-5 flex items-start gap-3 p-4 rounded-xl bg-red-950/60 border border-red-800/60 text-red-300 text-sm">

              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}

                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />

              </svg>

              <span>{serverError}</span>

            </div>

          )}



          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>

            <div>

              <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>

              <input

                type="text"

                autoComplete="username"

                placeholder="admin"

                {...register("username")}

                className={`w-full px-4 py-3 rounded-xl bg-slate-800/80 border text-white placeholder-slate-500

                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all

                  ${errors.username ? "border-red-500/70 focus:ring-red-500" : "border-slate-700 hover:border-slate-600"}`}

              />

              {errors.username && (<p className="mt-1.5 text-xs text-red-400">{errors.username.message}</p>)}

            </div>



            <div>

              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>

              <div className="relative">

                <input

                  type={showPassword ? "text" : "password"}

                  autoComplete="current-password"

                  placeholder="••••••••"

                  {...register("password")}

                  className={`w-full px-4 py-3 pr-12 rounded-xl bg-slate-800/80 border text-white placeholder-slate-500

                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all

                    ${errors.password ? "border-red-500/70 focus:ring-red-500" : "border-slate-700 hover:border-slate-600"}`}

                />

                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors p-1" tabIndex={-1} aria-label={showPassword ? "Hide password" : "Show password"}>

                  {showPassword ? (

                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}

                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />

                    </svg>

                  ) : (

                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />

                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />

                    </svg>

                  )}

                </button>

              </div>

              {errors.password && (<p className="mt-1.5 text-xs text-red-400">{errors.password.message}</p>)}

            </div>



            <button type="submit" disabled={isSubmitting} className="w-full py-3 px-4 rounded-xl font-semibold text-white text-sm bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950 transition-all duration-200 shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2">

              {isSubmitting ? (

                <>

                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">

                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />

                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />

                  </svg>

                  Signing in...

                </>

              ) : (

                <>

                  Login

                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">

                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />

                  </svg>

                </>

              )}

            </button>

          </form>



          <p className="mt-8 text-center text-xs text-slate-600">© {new Date().getFullYear()} Semantic Skills Junction LLP</p>

        </div>

      </div>

    </div>

  );

}

