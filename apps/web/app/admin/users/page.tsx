import { AdminSidebar } from "@/components/admin/Sidebar";
import { AdminTopbar } from "@/components/admin/Topbar";
import { UserStatusButton } from "@/components/admin/UserStatusButton";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { getAdminUsers } from "@/lib/admin";

const TONE: Record<string, BadgeTone> = { ACTIVE: "green", FLAGGED: "amber", SUSPENDED: "red" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const users = await getAdminUsers(q);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar current="Users" />
      <div className="flex-1">
        <AdminTopbar />
        <div className="px-6 pb-10">
          <div className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900">Users</h1>
              <p className="mt-1 text-sm text-slate-500">{users.length} users</p>
            </div>
            <form className="flex gap-2">
              <input
                name="q"
                defaultValue={q ?? ""}
                placeholder="Search email or name…"
                className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
              <button className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
                Search
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-slate-400">
                    <th className="pb-3 font-medium">User</th>
                    <th className="pb-3 font-medium">Country</th>
                    <th className="pb-3 font-medium">Balance</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Joined</th>
                    <th className="pb-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="py-3">
                        <p className="font-medium text-slate-800">{u.displayName ?? "—"}</p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </td>
                      <td className="py-3 text-slate-600">{u.country ?? "—"}</td>
                      <td className="py-3 font-semibold text-slate-900">
                        {(u.wallet?.balance ?? 0).toLocaleString()}
                      </td>
                      <td className="py-3">
                        <Badge tone={TONE[u.status] ?? "slate"}>{u.status}</Badge>
                      </td>
                      <td className="py-3 whitespace-nowrap text-slate-400">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3">
                        <UserStatusButton id={u.id} status={u.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
