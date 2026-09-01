import { redirect } from "next/navigation";

// Registration disabled — redirect to login.
// To re-enable: restore RegisterPage client form from git history.
export default function RegisterPage() {
  redirect("/login");
}
