import { Brand } from "@/types/brand";

import IdentityStep from "./steps/IdentityStep";
import AudienceStep from "./steps/AudienceStep";

interface StepRendererProps {
  currentStep: number;
  brand: Brand;
  updateField: (field: keyof Brand, value: string) => void;
}

export default function StepRenderer({
  currentStep,
  brand,
  updateField,
}: StepRendererProps) {
  switch (currentStep) {
    case 1:
      return (
        <IdentityStep
          data={{
            name: brand.name,
            tagline: brand.tagline,
            description: brand.description,
          }}
          onChange={updateField}
        />
      );

    case 2:
      return (
        <AudienceStep
          data={{
            primaryPlatform: brand.primaryPlatform,
            language: brand.language,
            targetCountry: brand.targetCountry,
            targetAudience: brand.targetAudience,
          }}
          onChange={updateField}
        />
      );

    default:
      return (
        <div className="border rounded-2xl p-10 text-center text-gray-500">
          Step {currentStep} coming next...
        </div>
      );
  }
}