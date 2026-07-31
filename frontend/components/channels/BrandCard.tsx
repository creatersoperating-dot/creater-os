import Link from "next/link";
import { Brand } from "@/types/brand";

interface BrandCardProps {
  brand: Brand;
}

export default function BrandCard({ brand }: BrandCardProps) {
  return (
    <Link href={`/brands/${brand.id}/projects`}>
      <div className="bg-white rounded-xl shadow p-6 hover:shadow-xl hover:scale-[1.02] transition-all duration-200 cursor-pointer">

        <h2 className="text-2xl font-bold">
          {brand.name}
        </h2>

        <p className="text-gray-500 mt-2">
          {brand.description}
        </p>

        <div className="mt-4 space-y-2 text-sm">

          <p>
            <strong>Platform:</strong> {brand.primaryPlatform}
          </p>

          <p>
            <strong>Niche:</strong> {brand.primaryNiche}
          </p>

          <p>
            <strong>Audience:</strong> {brand.targetAudience}
          </p>

          <p>
            <strong>Status:</strong> {brand.status}
          </p>

        </div>

      </div>
    </Link>
  );
}
