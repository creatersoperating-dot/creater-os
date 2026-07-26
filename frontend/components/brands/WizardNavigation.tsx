interface WizardNavigationProps {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
}

export default function WizardNavigation({
  currentStep,
  totalSteps,
  onBack,
  onNext,
}: WizardNavigationProps) {
  return (
    <div className="flex justify-between mt-10">

      <button
        onClick={onBack}
        disabled={currentStep === 1}
        className="px-5 py-3 rounded-xl border disabled:opacity-40"
      >
        Back
      </button>

      <button
        onClick={onNext}
        className="bg-blue-600 text-white px-5 py-3 rounded-xl"
      >
        {currentStep === totalSteps
          ? "Create Brand"
          : "Next"}
      </button>

    </div>
  );
}