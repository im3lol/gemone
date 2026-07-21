import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { Offer } from "@/lib/offers";

const CAT_LABEL: Record<Offer["category"], string> = {
  game: "Game",
  survey: "Survey",
  app: "App",
  signup: "Sign Up",
  shopping: "Shopping",
  video: "Video",
};
const CAT_TONE: Record<Offer["category"], BadgeTone> = {
  game: "purple",
  survey: "amber",
  app: "slate",
  signup: "blue",
  shopping: "pink",
  video: "indigo",
};
const DIFF_TONE: Record<Offer["difficulty"], BadgeTone> = {
  Easy: "green",
  Medium: "amber",
  Hard: "red",
};

/** Responsive grid of offer cards. Each card deep-links to the provider with the
 *  user's sub_id embedded, so completions post back and credit automatically. */
export function OffersGrid({ offers, empty }: { offers: Offer[]; empty?: string }) {
  if (offers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
        <p className="text-sm text-slate-400">{empty ?? "No offers available right now — check back soon."}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {offers.map((o) => (
        <a
          key={o.id}
          href={o.clickUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-brand-200 hover:shadow-md"
        >
          <div
            className="grid h-28 w-full place-items-center rounded-xl text-3xl font-bold text-white"
            style={{ background: o.color }}
          >
            {o.icon}
          </div>
          <p className="mt-3 truncate text-sm font-bold text-slate-900">{o.title}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={DIFF_TONE[o.difficulty]}>{o.difficulty}</Badge>
            <Badge tone={CAT_TONE[o.category]}>{CAT_LABEL[o.category]}</Badge>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-lg font-bold text-slate-900">{o.points.toLocaleString()}</span>
            <span className="text-xs text-brand-600">≈ ${o.payoutUsd}</span>
          </div>
          <p className="mt-1 truncate text-xs text-slate-400">{o.description}</p>
        </a>
      ))}
    </div>
  );
}
