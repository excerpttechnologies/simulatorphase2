import { getAuthUser } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login");

  await connectDB();
  const user = await User.findById(authUser.userId);
  if (!user) redirect("/login");

  const stats = [
    { label: "Account Status", value: user.isActive ? "Active" : "Inactive", color: user.isActive ? "text-green-600" : "text-red-600", bg: "bg-green-50 dark:bg-green-900/20" },
    { label: "Role", value: user.role.charAt(0).toUpperCase() + user.role.slice(1), color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
    { label: "Member Since", value: new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" }), color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-900/20" },
    { label: "Last Login", value: user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : "First login", color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-900/20" },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Welcome back, {user.name.split(" ")[0]} 👋
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Here&apos;s an overview of your account.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className={`rounded-xl p-5 ${stat.bg} border border-slate-200 dark:border-slate-700`}>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
              {stat.label}
            </p>
            <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Profile card */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 max-w-lg">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Account Details</h2>
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-primary-600 flex items-center justify-center text-white text-2xl font-bold">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">{user.name}</p>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{user.email}</p>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-semibold
              ${user.role === "admin" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"}`}>
              {user.role.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          {[
            { label: "User ID", value: user._id.toString() },
            { label: "Email", value: user.email },
            { label: "Created", value: new Date(user.createdAt).toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
              <span className="text-slate-500 dark:text-slate-400">{label}</span>
              <span className="text-slate-900 dark:text-white font-medium truncate max-w-[200px]">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
