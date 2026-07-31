"use client";

import { useEffect, useState } from "react";

import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/client";

export default function Navbar() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    async function loadUser() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (isMounted) {
          setEmail(user?.email ?? null);
        }
      } catch {
        // Keep the signed-in fallback when identity lookup is unavailable.
      }
    }

    void loadUser();

    return () => {
      isMounted = false;
    };
  }, []);
  return (
    <header className="h-16 bg-slate-900 text-white flex items-center justify-between px-8">

      <h1 className="text-2xl font-bold">
        CreatorOS
      </h1>

      <div>
        <div className="flex items-center gap-3">
          <span className="max-w-64 truncate text-sm text-slate-300">
            {email || "Signed in"}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-white/25 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

    </header>
  );
}
