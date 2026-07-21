import { PageShell } from "@/components/dashboard/PageShell";
import { PasswordForm, ProfileForm } from "@/components/dashboard/SettingsForms";
import { getMe } from "@/lib/me";

export const metadata = { title: "Settings — GemOne" };

export default async function SettingsPage() {
  const me = await getMe();
  return (
    <PageShell current="Settings" title="Settings" subtitle="Manage your account.">
      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileForm me={me} />
        <PasswordForm />
      </div>
    </PageShell>
  );
}
