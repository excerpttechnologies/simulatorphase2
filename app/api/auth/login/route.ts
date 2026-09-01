import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/jwt";
import { validateAdminCredentials, ADMIN_USER } from "@/lib/auth-config";
import { z } from "zod";

export const runtime = "nodejs";

// To re-enable database auth: restore connectDB + User.findOne in this handler.
const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: "Invalid username or password" },
        { status: 400 }
      );
    }

    const { username, password } = parsed.data;

    if (!validateAdminCredentials(username, password)) {
      return NextResponse.json(
        { success: false, message: "Invalid username or password" },
        { status: 401 }
      );
    }

    const token = signToken({
      userId: ADMIN_USER.id,
      email: ADMIN_USER.email,
      role: ADMIN_USER.role,
    });

    // Token returned in JSON only — client keeps it in memory (no cookie / localStorage)
    return NextResponse.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: ADMIN_USER.id,
        name: ADMIN_USER.name,
        username: ADMIN_USER.username,
        email: ADMIN_USER.email,
        role: ADMIN_USER.role,
      },
    });
  } catch (err) {
    console.error("[LOGIN]", err);
    return NextResponse.json(
      { success: false, message: "Server error. Please try again." },
      { status: 500 }
    );
  }
}
