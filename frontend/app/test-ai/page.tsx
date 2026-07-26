import { getBrands } from "@/services/brandService";

export default function TestAI() {
  const brands = getBrands();

  return (
    <pre className="p-8 whitespace-pre-wrap">
      {JSON.stringify(brands, null, 2)}
    </pre>
  );
}