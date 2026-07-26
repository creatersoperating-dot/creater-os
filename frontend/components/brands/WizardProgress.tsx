interface WizardProgressProps {
  currentStep: number;
  totalSteps: number;
}

export default function WizardProgress({
  currentStep,
  totalSteps,
}: WizardProgressProps) {
  const percentage = (currentStep / totalSteps) * 100;

  return (
    <div className="mb-8">

      <div className="flex justify-between text-sm mb-2">
        <span>
          Step {currentStep} of {totalSteps}
        </span>

        <span>
          {Math.round(percentage)}%
        </span>
      </div>

      <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">

        <div
          className="h-full bg-blue-600 transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />

      </div>

    </div>
  );
}