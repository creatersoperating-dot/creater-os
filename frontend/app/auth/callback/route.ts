import {
  NextResponse,
  type NextRequest,
} from "next/server";

import { createClient } from "@/lib/supabase/server";

function getSafeNextPath(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/dashboard";
  }

  return value;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = getSafeNextPath(
    request.nextUrl.searchParams.get("next")
  );

  if (code) {
    const supabase = await createClient();
    const { error } =
      await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(
        `${request.nextUrl.origin}${next}`
      );
    }
  }

  const errorMessage = code
    ? "Authentication could not be completed. Please try again."
    : "The authentication link is missing a required code.";

  return NextResponse.redirect(
    `${request.nextUrl.origin}/login?error=${encodeURIComponent(
      errorMessage
    )}`
  );
}
