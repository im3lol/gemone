import { Logo } from "@/components/ui/Logo";

const HREFS: Record<string, string> = {
  "Terms of Service": "/terms",
  "Privacy Policy": "/privacy",
  "Cookie Policy": "/cookies",
};

const columns = [
  { title: "Platform", links: ["How it works", "Earn", "Rewards", "Referrals", "Blog"] },
  { title: "Company", links: ["About us", "Careers", "Press", "Terms of Service", "Privacy Policy"] },
  { title: "Support", links: ["Help Center", "Contact us", "Payment Proofs", "Community"] },
  { title: "Legal", links: ["Terms of Service", "Privacy Policy", "Cookie Policy", "GDPR"] },
];

export function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-white py-12">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-slate-500">
              Earn rewards. Your way. Anytime, anywhere.
            </p>
            <div className="mt-4 flex gap-3 text-slate-400">
              {["💬", "𝕏", "📷", "▶️"].map((s, i) => (
                <span key={i} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-sm">
                  {s}
                </span>
              ))}
            </div>
          </div>
          {columns.map((c) => (
            <div key={c.title}>
              <h4 className="text-sm font-bold text-slate-900">{c.title}</h4>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-500">
                {c.links.map((l) => (
                  <li key={l}>
                    <a href={HREFS[l] ?? "#"} className="hover:text-slate-900">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 border-t border-slate-100 pt-6 text-center text-sm text-slate-400">
          © 2026 GemOne. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
