import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Password reset disabled — single hardcoded admin account.
export async function POST() {
  return NextResponse.json(
    { success: false, message: "Password reset is disabled" },
    { status: 403 }
  );
}
