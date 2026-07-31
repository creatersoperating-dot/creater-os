import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";

import DashboardLayout from "@/components/layout/DashboardLayout";
import ScriptLibrary from "@/components/scripts/ScriptLibrary";
import { getServerCloudBrandById } from "@/services/serverCloudBrandService";

interface BrandScriptsPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function BrandScriptsPage({
  params,
}: BrandScriptsPageProps) {
  const { id } = await params;
  const brand = await getServerCloudBrandById(id);

  if (!brand) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <h1 className="text-3xl font-bold">Brand not found</h1>

          <p className="mt-2 text-gray-500">
            The requested brand does not exist.
          </p>

          <pre className="mt-4 rounded bg-gray-100 p-4">
            Requested ID: {id}
          </pre>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="-m-8 min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[1500px] space-y-8">
          <header className="overflow-hidden rounded-[28px] bg-[linear-gradient(115deg,#0f172a_0%,#1e1b4b_100%)] px-5 py-7 text-white shadow-[0_24px_70px_-28px_rgba(15,23,42,0.85)] sm:px-8 sm:py-9 lg:px-10">
            <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <Link
                  href={`/brands/${brand.id}/projects`}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-200 transition hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back to Video Projects
                </Link>

                <div className="mt-6 flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500 text-white shadow-lg shadow-indigo-950/30">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-indigo-200">
                    Saved work
                  </p>
                </div>

                <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
                  Script Library
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
                  Review and manage scripts saved for this brand.
                </p>
              </div>

              <span className="max-w-full truncate rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm">
                {brand.name}
              </span>
            </div>
          </header>

          <ScriptLibrary brandId={brand.id} />
        </div>
      </div>
    </DashboardLayout>
  );
}
