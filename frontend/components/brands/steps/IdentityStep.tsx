import { Brand } from "@/types/brand";

interface IdentityStepProps {
  data: Pick<Brand, "name" | "tagline" | "description">;
  onChange: (field: keyof Brand, value: string) => void;
}

export default function IdentityStep({
  data,
  onChange,
}: IdentityStepProps) {
  return (
    <div className="space-y-6">
      <input
        className="w-full border rounded-xl p-3"
        placeholder="Brand Name"
        value={data.name}
        onChange={(e) => onChange("name", e.target.value)}
      />

      <input
        className="w-full border rounded-xl p-3"
        placeholder="Tagline"
        value={data.tagline}
        onChange={(e) => onChange("tagline", e.target.value)}
      />

      <textarea
        className="w-full border rounded-xl p-3 h-32"
        placeholder="Description"
        value={data.description}
        onChange={(e) => onChange("description", e.target.value)}
      />
    </div>
  );
}