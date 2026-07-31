import DashboardLayout from "@/components/layout/DashboardLayout";
import VideoProjectsWorkspace from "@/components/video-projects/VideoProjectsWorkspace";
import { getServerCloudBrandById } from "@/services/serverCloudBrandService";

interface BrandVideoProjectsPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function BrandVideoProjectsPage({
  params,
}: BrandVideoProjectsPageProps) {
  const { id } = await params;
  const brand = await getServerCloudBrandById(id);

  if (!brand) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <h1 className="text-3xl font-bold">
            Brand not found
          </h1>

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
      <VideoProjectsWorkspace
        brandId={brand.id}
        brandName={brand.name}
      />
    </DashboardLayout>
  );
}
