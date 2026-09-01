import { redirect } from "next/navigation";

// Password reset disabled — redirect to login.
export default function ForgotPasswordPage() {
  redirect("/login");
}
