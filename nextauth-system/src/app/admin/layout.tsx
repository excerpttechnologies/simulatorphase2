import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { Sidebar } from "@/components/dashboard/Sidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login");
  if (authUser.role !== "admin") redirect("/dashboard");

  await connectDB();
  const user = await User.findById(authUser.userId);
  if (!user || !user.isActive) redirect("/login");

  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-slate-900">
      <Sidebar user={{ name: user.name, email: user.email, role: user.role }} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
