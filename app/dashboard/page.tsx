import { redirect } from "next/navigation";

// Dashboard redirects to the main simulation
export default function DashboardPage() {
  redirect("/");
}
