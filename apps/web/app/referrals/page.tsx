import { PageShell } from "@/components/dashboard/PageShell";
import { ReferralPanel } from "@/components/dashboard/ReferralPanel";
import { getReferral } from "@/lib/referrals";

export const metadata = { title: "Referrals — GemOne" };

export default async function ReferralsPage() {
  const referral = await getReferral();
  return (
    <PageShell current="Referrals" title="Referrals" subtitle="Bring friends in and earn a cut of everything they make.">
      <ReferralPanel referral={referral} />
    </PageShell>
  );
}
