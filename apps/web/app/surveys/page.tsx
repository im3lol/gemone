import { OffersGrid } from "@/components/dashboard/OffersGrid";
import { PageShell } from "@/components/dashboard/PageShell";
import { getOffers } from "@/lib/offers";

export const metadata = { title: "Surveys — GemOne" };

export default async function SurveysPage() {
  const offers = (await getOffers()).filter((o) => o.category === "survey");
  return (
    <PageShell current="Surveys" title="Surveys" subtitle="Share your opinion and get paid for it.">
      <OffersGrid offers={offers} empty="No surveys available right now — check back soon." />
    </PageShell>
  );
}
