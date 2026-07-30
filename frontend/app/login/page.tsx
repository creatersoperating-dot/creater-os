import { login, signup } from "./actions";

interface LoginPageProps {
  searchParams: Promise<{
    error?: string;
    message?: string;
  }>;
}

function decodeFeedback(value: string | undefined): string {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const inputClassName =
  "mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100";

export default async function LoginPage({
  searchParams,
}: LoginPageProps) {
  const params = await searchParams;
  const error = decodeFeedback(params.error);
  const message = decodeFeedback(params.message);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mx-auto max-w-3xl text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-lg font-black text-white shadow-lg shadow-indigo-600/20">
            C
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.24em] text-indigo-600">
            CreatorOS
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Your creator workspace, now in the cloud
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            Sign in to keep your brands and scripts connected to
            one secure CreatorOS workspace.
          </p>
        </header>

        {(error || message) && (
          <div className="mx-auto mt-8 max-w-2xl" aria-live="polite">
            {error && (
              <div
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 shadow-sm"
                role="alert"
              >
                {error}
              </div>
            )}
            {!error && message && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 shadow-sm">
                {message}
              </div>
            )}
          </div>
        )}

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.35)] sm:p-8">
            <div className="border-b border-slate-100 pb-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
                Welcome back
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
                Sign in
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Continue to your existing CreatorOS workspace.
              </p>
            </div>

            <form action={login} className="mt-6 space-y-5">
              <label className="block">
                <span className="text-sm font-semibold text-slate-800">
                  Email
                </span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  className={inputClassName}
                  placeholder="you@example.com"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-800">
                  Password
                </span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  minLength={6}
                  required
                  className={inputClassName}
                  placeholder="At least 6 characters"
                />
              </label>

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-slate-950/15 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-300"
              >
                Sign in
              </button>
            </form>
          </section>

          <section className="rounded-3xl border border-indigo-200 bg-white p-6 shadow-[0_20px_50px_-24px_rgba(79,70,229,0.4)] sm:p-8">
            <div className="border-b border-indigo-100 pb-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">
                New workspace
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
                Create account
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Start a cloud workspace for your brands and
                creative work.
              </p>
            </div>

            <form action={signup} className="mt-6 space-y-5">
              <label className="block">
                <span className="text-sm font-semibold text-slate-800">
                  Email
                </span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  className={inputClassName}
                  placeholder="you@example.com"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-800">
                  Password
                </span>
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  className={inputClassName}
                  placeholder="At least 6 characters"
                />
              </label>

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:from-indigo-700 hover:to-violet-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200"
              >
                Create account
              </button>

              <p className="text-xs leading-5 text-slate-500">
                Depending on your workspace settings, you may need
                to confirm your email before signing in.
              </p>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
