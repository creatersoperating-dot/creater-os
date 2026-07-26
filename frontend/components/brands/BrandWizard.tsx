"use client";

import { useState } from "react";

import { Brand } from "@/types/brand";
import { defaultBrand } from "@/lib/defaultBrand";

import WizardSidebar from "./WizardSidebar";
import WizardHeader from "./WizardHeader";
import WizardProgress from "./WizardProgress";
import WizardNavigation from "./WizardNavigation";
import StepRenderer from "./StepRenderer";

interface BrandWizardProps {
  onSubmit: (data: {
    name: string;
    description: string;
  }) => void;
}

export default function BrandWizard({
  onSubmit,
}: BrandWizardProps) {
  const totalSteps = 6;

  const [currentStep, setCurrentStep] = useState(1);

  const [brand, setBrand] = useState<Brand>(defaultBrand);

  function updateField(
    field: keyof Brand,
    value: string
  ) {
    setBrand((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  function nextStep() {
    if (currentStep < totalSteps) {
      setCurrentStep((prev) => prev + 1);
      return;
    }

    onSubmit({
      name: brand.name,
      description: brand.description,
    });
  }

  function previousStep() {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  }

  return (
    <div className="flex gap-8">

      <WizardSidebar
        currentStep={currentStep}
      />

      <div className="flex-1">

        <WizardHeader
          title="Create Brand"
          subtitle="Teach CreatorOS everything about your brand."
        />

        <WizardProgress
          currentStep={currentStep}
          totalSteps={totalSteps}
        />

        <StepRenderer
          currentStep={currentStep}
          brand={brand}
          updateField={updateField}
        />

        <WizardNavigation
          currentStep={currentStep}
          totalSteps={totalSteps}
          onBack={previousStep}
          onNext={nextStep}
        />

      </div>

    </div>
  );
}