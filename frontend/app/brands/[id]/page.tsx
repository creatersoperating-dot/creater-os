import DashboardLayout from "@/components/layout/DashboardLayout";
import { getBrandById } from "@/services/brandService";
import ChatWindow from "@/components/ai/ChatWindow";

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
      <div className="space-y-8">
        <div>
          <h1 className="text-4xl font-bold">
            {brand.name}
          </h1>

          <p className="text-gray-500 mt-2">
            {brand.primaryPlatform} • {brand.primaryNiche} • {brand.language}
          </p>
        </div>

        <ChatWindow />
      </div>
    </DashboardLayout>
  );
}