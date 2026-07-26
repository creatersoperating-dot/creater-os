interface WizardSidebarProps {
  currentStep: number;
}

const steps = [
  "Identity",
  "Audience",
  "Strategy",
  "Content",
  "AI Brain",
  "Review",
];

export default function WizardSidebar({
  currentStep,
}: WizardSidebarProps) {
  return (
    <div className="w-72 bg-gray-50 rounded-2xl p-6 border">

      <h2 className="text-xl font-bold mb-2">
        Brand Setup
      </h2>

      <p className="text-gray-500 text-sm mb-8">
        Build the AI brain for your creator business.
      </p>

      <div className="space-y-3">

        {steps.map((step, index) => {
          const active = currentStep === index + 1;
          const completed = currentStep > index + 1;

          return (
            <div
              key={step}
              className={`flex items-center gap-4 rounded-xl px-4 py-3 transition-all duration-300
              ${
                active
                  ? "bg-blue-600 text-white shadow-lg"
                  : completed
                  ? "bg-green-100 text-green-700"
                  : "bg-white border"
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold
                ${
                  active
                    ? "bg-white text-blue-600"
                    : completed
                    ? "bg-green-600 text-white"
                    : "bg-gray-200 text-gray-700"
                }`}
              >
                {completed ? "✓" : index + 1}
              </div>

              <span className="font-medium">
                {step}
              </span>
            </div>
          );
        })}

      </div>
    </div>
  );
}