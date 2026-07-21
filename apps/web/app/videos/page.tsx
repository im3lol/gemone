import { OffersGrid } from "@/components/dashboard/OffersGrid";
import { PageShell } from "@/components/dashboard/PageShell";
import { getOffers } from "@/lib/offers";

export const metadata = { title: "Watch Videos — GemOne" };

export default async function VideosPage() {
  const offers = (await getOffers()).filter((o) => o.category === "video");
  return (
    <PageShell current="Watch Videos" title="Watch Videos" subtitle="Earn points for watching short videos and ads.">
      <OffersGrid offers={offers} empty="No video offers available right now — check back soon." />
    </PageShell>
  );
}
