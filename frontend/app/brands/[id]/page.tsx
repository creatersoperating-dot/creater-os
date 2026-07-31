import DashboardLayout from "@/components/layout/DashboardLayout";
import { redirect } from "next/navigation";
import { getServerCloudBrandById } from "@/services/serverCloudBrandService";

interface BrandWorkspaceProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function BrandWorkspace({
  params,
}: BrandWorkspaceProps) {
  const { id } = await params;

  const brand = await getServerCloudBrandById(id);

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

  redirect(`/brands/${brand.id}/projects`);
}
