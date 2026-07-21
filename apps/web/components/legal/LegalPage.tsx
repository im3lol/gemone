import type { ReactNode } from "react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-white">
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-display text-4xl font-extrabold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">Last updated: {updated}</p>
        <div className="legal mt-8 space-y-6 text-slate-600 leading-relaxed [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mt-1 [&_a]:font-medium [&_a]:text-brand-600">
          {children}
        </div>
        <p className="mt-12 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          This is a template for launch and not legal advice — have counsel review before going live.
        </p>
      </main>
      <Footer />
    </div>
  );
}
