interface WizardHeaderProps {
  title: string;
  subtitle: string;
}

export default function WizardHeader({
  title,
  subtitle,
}: WizardHeaderProps) {
  return (
    <div className="mb-8">
      <h2 className="text-3xl font-bold">{title}</h2>

      <p className="mt-2 text-gray-500">
        {subtitle}
      </p>
    </div>
  );
}