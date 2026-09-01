/**
 * Hardcoded admin authentication (no database).
 *
 * To re-enable database auth later:
 * - Restore MongoDB checks in app/api/auth/login/route.ts
 * - Re-enable app/api/auth/register/route.ts
 */

export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "Admin@123";

export const ADMIN_USER = {
  id: "admin",
  name: "Administrator",
  username: ADMIN_USERNAME,
  email: "admin@localhost",
  role: "admin" as const,
};

export function validateAdminCredentials(
  username: string,
  password: string
): boolean {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}

/** Legacy key — cleared on load; auth is memory-only via AuthContext */
export const AUTH_STORAGE_KEY = "isLoggedIn";
