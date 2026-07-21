import { PageShell } from "@/components/dashboard/PageShell";
import { getMe } from "@/lib/me";
import { adgemWall } from "@/lib/offerwall";

export const metadata = { title: "Earn — GemOne" };

export default async function EarnPage() {
  const me = await getMe();
  const wall = adgemWall(me.id);

  return (
    <PageShell
      current="Earn"
      title="Earn"
      subtitle="Complete offers on the wall below — points land in your wallet automatically."
    >
      {wall.configured ? (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <iframe
            src={wall.url!}
            title="AdGem offerwall"
            className="h-[calc(100vh-220px)] min-h-[560px] w-full border-0"
            allow="fullscreen"
          />
        </div>
      ) : (
        <SetupCard />
      )}
    </PageShell>
  );
}

// Shown until an AdGem app id is configured. The code path is real — the moment
// ADGEM_APP_ID is set the iframe above goes live.
function SetupCard() {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8">
      <div className="flex items-start gap-4">
        <span className="text-4xl">🧩</span>
        <div>
          <h2 className="text-lg font-bold text-slate-900">AdGem wall not configured yet</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            The offerwall goes live the moment an AdGem app is connected. Until then, the earning
            loop (wallet, postback, withdrawals) is fully wired and testable.
          </p>
          <ol className="mt-4 max-w-2xl list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>
              Create an app at{" "}
              <span className="font-medium">AdGem → Publisher dashboard</span> and copy its{" "}
              <code className="rounded bg-white px-1.5 py-0.5 text-xs">App ID</code> and{" "}
              <code className="rounded bg-white px-1.5 py-0.5 text-xs">Postback secret</code>.
            </li>
            <li>
              Set the app&apos;s postback URL to{" "}
              <code className="rounded bg-white px-1.5 py-0.5 text-xs">
                https://&lt;your-api&gt;/postback/adgem
              </code>
              .
            </li>
            <li>
              Add <code className="rounded bg-white px-1.5 py-0.5 text-xs">ADGEM_APP_ID</code> (web) and{" "}
              <code className="rounded bg-white px-1.5 py-0.5 text-xs">ADGEM_POSTBACK_SECRET</code> (api),
              then redeploy.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
