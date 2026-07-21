"use client";

import { useTransition } from "react";
import { setUserStatusAction } from "@/app/admin-actions";

export function UserStatusButton({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const suspended = status === "SUSPENDED";
  const next = suspended ? "ACTIVE" : "SUSPENDED";

  return (
    <button
      disabled={pending}
      onClick={() => start(() => setUserStatusAction(id, next))}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
        suspended
          ? "bg-brand-500 text-white hover:bg-brand-600"
          : "border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
      }`}
    >
      {suspended ? "Reinstate" : "Suspend"}
    </button>
  );
}
