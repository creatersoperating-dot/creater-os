import { createServerClient } from "@supabase/ssr";
import {
  NextResponse,
  type NextRequest,
} from "next/server";

function redirectWithCookies(
  url: URL,
  supabaseResponse: NextResponse
) {
  const redirectResponse = NextResponse.redirect(url);

  supabaseResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          supabaseResponse = NextResponse.next({ request });

          cookiesToSet.forEach(
            ({ name, value, options }) =>
              supabaseResponse.cookies.set(
                name,
                value,
                options
              )
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);
  const pathname = request.nextUrl.pathname;
  const isProtectedWorkspaceRoute =
    pathname === "/dashboard" ||
    pathname === "/brands" ||
    pathname.startsWith("/brands/");

  if (!isAuthenticated && isProtectedWorkspaceRoute) {
    const loginUrl = new URL(request.url);
    loginUrl.pathname = "/login";
    loginUrl.search = "";

    return redirectWithCookies(loginUrl, supabaseResponse);
  }

  if (isAuthenticated && pathname === "/login") {
    const dashboardUrl = new URL(request.url);
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";

    return redirectWithCookies(
      dashboardUrl,
      supabaseResponse
    );
  }

  return supabaseResponse;
}
