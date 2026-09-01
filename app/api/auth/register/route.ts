import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Registration disabled — hardcoded admin only.
// To re-enable: restore MongoDB User.create flow from git history.
export async function POST() {
  return NextResponse.json(
    { success: false, message: "Registration is disabled" },
    { status: 403 }
  );
}
