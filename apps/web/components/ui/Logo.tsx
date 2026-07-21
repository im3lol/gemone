import Link from "next/link";

export function GemMark({ className = "h-8 w-8" }: { className?: string }) {
  // ponytail: simple SVG gem/hexagon, swap for real brand asset when available
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M8 4h16l6 10-14 14L2 14 8 4Z" fill="#039855" />
      <path d="M16 4h8l6 10-14 14 0-24Z" fill="#12b76a" />
      <path d="M8 4h16l-4 8H12L8 4Z" fill="#32d583" opacity="0.85" />
    </svg>
  );
}

export function Logo({
  href = "/",
  className = "",
  markClass,
  textClass = "text-xl font-bold tracking-tight text-slate-900",
}: {
  href?: string;
  className?: string;
  markClass?: string;
  textClass?: string;
}) {
  return (
    <Link href={href} className={`flex items-center gap-2 ${className}`}>
      <GemMark className={markClass ?? "h-8 w-8"} />
      <span className={`font-display ${textClass}`}>GemOne</span>
    </Link>
  );
}
