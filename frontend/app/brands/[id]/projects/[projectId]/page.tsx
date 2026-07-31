import DashboardLayout from "@/components/layout/DashboardLayout";
import VideoProjectProductionWorkspace from "@/components/video-projects/VideoProjectProductionWorkspace";
import { getServerCloudBrandById } from "@/services/serverCloudBrandService";
import { getServerCloudVideoProjectById } from "@/services/serverCloudVideoProjectService";

interface VideoProjectPageProps {
  params: Promise<{
    id: string;
    projectId: string;
  }>;
}

export default async function VideoProjectPage({
  params,
}: VideoProjectPageProps) {
  const { id, projectId } = await params;
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

  const project = await getServerCloudVideoProjectById(
    brand.id,
    projectId,
  );

  if (!project || project.brandId !== brand.id) {
    return (
      <DashboardLayout>
        <div className="p-8">
          <h1 className="text-3xl font-bold">
            Video project not found
          </h1>

          <p className="mt-2 text-gray-500">
            The requested video project does not exist for this
            brand.
          </p>

          <pre className="mt-4 rounded bg-gray-100 p-4">
            Requested project ID: {projectId}
          </pre>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <VideoProjectProductionWorkspace
        brandId={brand.id}
        brandName={brand.name}
        initialProject={project}
      />
    </DashboardLayout>
  );
}
