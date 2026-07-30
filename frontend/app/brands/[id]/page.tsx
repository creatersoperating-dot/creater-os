import DashboardLayout from "@/components/layout/DashboardLayout";
import { getBrandById } from "@/services/brandService";
import ChatWindow from "@/components/ai/ChatWindow";
import ScriptWriter from "@/components/scripts/ScriptWriter";
import ScriptLibrary from "@/components/scripts/ScriptLibrary";

interface BrandWorkspaceProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function BrandWorkspace({
  params,
}: BrandWorkspaceProps) {
  const { id } = await params;

  const brand = getBrandById(id);

  if (!brand) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <h1 className="text-3xl font-bold">
            Brand not found
          </h1>

          <p className="text-gray-500 mt-2">
            The requested brand does not exist.
          </p>

          <pre className="mt-4 bg-gray-100 p-4 rounded">
            Requested ID: {id}
          </pre>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="-m-8 min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[1500px] space-y-10">
          <section aria-label="Script Writer workspace">
      <ScriptWriter brand={brand} />
      <ScriptLibrary brandId={brand.id} />
          </section>

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_20px_60px_-30px_rgba(15,23,42,0.4)]">
            <div className="flex flex-col gap-5 border-b border-slate-200 px-5 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-7">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600">
                  Brand assistant
                </p>
                <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                  Brand Chat
                </h2>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Ask questions, explore ideas, and continue working
                  with the general CreatorOS assistant for this brand.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  {brand.primaryPlatform}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  {brand.primaryNiche}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                  {brand.language}
                </span>
              </div>
            </div>

            <div className="bg-slate-100/80 p-3 sm:p-5 lg:p-6">
              <ChatWindow brand={brand} />
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
