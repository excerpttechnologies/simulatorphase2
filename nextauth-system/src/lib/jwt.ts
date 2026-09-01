import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = "7d";

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export function signToken(payload: Omit<JWTPayload, "iat" | "exp">): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}

export function signResetToken(userId: string): string {
  return jwt.sign({ userId, purpose: "reset" }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

export function verifyResetToken(token: string): { userId: string } {
  const payload = jwt.verify(token, JWT_SECRET) as {
    userId: string;
    purpose: string;
  };
  if (payload.purpose !== "reset") throw new Error("Invalid token purpose");
  return { userId: payload.userId };
}
