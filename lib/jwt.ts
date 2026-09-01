import jwt from "jsonwebtoken";

// Set JWT_SECRET in production .env (recommended).
const SECRET =
  process.env.JWT_SECRET || "smsim-dev-jwt-secret-change-in-production";

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export function signToken(payload: Omit<JWTPayload, "iat" | "exp">): string {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, SECRET) as JWTPayload;
}
