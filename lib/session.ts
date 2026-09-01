import { cookies } from "next/headers";
import { verifyToken, type JWTPayload } from "./jwt";

export const AUTH_COOKIE = "smsim_auth";

export async function getSession(): Promise<JWTPayload | null> {
  try {
    const store = await cookies();
    const token = store.get(AUTH_COOKIE)?.value;
    if (!token) return null;
    return verifyToken(token);
  } catch {
    return null;
  }
}

export function cookieOpts(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
