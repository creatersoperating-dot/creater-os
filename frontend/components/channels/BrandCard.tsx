import { Brand } from "@/types/brand";

interface BrandCardProps {
  brand: Brand;
}

export default function BrandCard({ brand }: BrandCardProps) {
  return (
    <div className="bg-white rounded-xl shadow p-6 hover:shadow-lg transition">
      <h2 className="text-2xl font-bold">{brand.name}</h2>

      <p className="text-gray-500 mt-2">
        {brand.description}
      </p>

      <div className="mt-4 space-y-2 text-sm">
        <p>
          <strong>Platform:</strong> {brand.primaryPlatform}
        </p>

        <p>
          <strong>Niche:</strong> {brand.niche}
        </p>

        <p>
          <strong>Language:</strong> {brand.language}
        </p>

        <p>
          <strong>Status:</strong> {brand.status}
        </p>
      </div>
    </div>
  );
}