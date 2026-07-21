import { OffersGrid } from "@/components/dashboard/OffersGrid";
import { PageShell } from "@/components/dashboard/PageShell";
import { getOffers } from "@/lib/offers";

export const metadata = { title: "Tasks — GemOne" };

// "Tasks" = everything that isn't a survey or a video: games, apps, sign-ups, shopping.
const TASK_CATEGORIES = new Set(["game", "app", "signup", "shopping"]);

export default async function TasksPage() {
  const offers = (await getOffers()).filter((o) => TASK_CATEGORIES.has(o.category));
  return (
    <PageShell current="Tasks" title="Tasks" subtitle="Install apps, sign up, and complete quick tasks for rewards.">
      <OffersGrid offers={offers} empty="No tasks available right now — check back soon." />
    </PageShell>
  );
}
