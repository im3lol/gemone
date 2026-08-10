import type { Session } from '$lib/server/session';

declare global {
  namespace App {
    interface Locals {
      /** Set by `hooks.server.ts` on every request. Null when logged out. */
      session: Session | null;
    }
  }
}

export {};
