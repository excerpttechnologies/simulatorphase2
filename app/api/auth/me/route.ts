import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { ADMIN_USER } from "@/lib/auth-config";

export const runtime = "nodejs";

function tokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export async function GET(req: NextRequest) {
  const token = tokenFromRequest(req);
  if (!token) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const session = verifyToken(token);
  if (!session) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    user: {
      id: ADMIN_USER.id,
      name: ADMIN_USER.name,
      username: ADMIN_USER.username,
      email: ADMIN_USER.email,
      role: ADMIN_USER.role,
      isActive: true,
    },
  });
}
