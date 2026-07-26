import { Brand } from "@/types/brand";

interface AudienceStepProps {
  data: Pick<
    Brand,
    "primaryPlatform" |
    "language" |
    "targetCountry" |
    "targetAudience"
  >;

  onChange: (
    field: keyof Brand,
    value: string
  ) => void;
}

export default function AudienceStep({
  data,
  onChange,
}: AudienceStepProps) {
  return (
    <div className="space-y-6">

      <div>
        <label className="block mb-2 font-medium">
          Platform
        </label>

        <select
          className="w-full border rounded-xl p-3"
          value={data.primaryPlatform}
          onChange={(e) =>
            onChange("primaryPlatform", e.target.value)
          }
        >
          <option>YouTube</option>
        </select>
      </div>

      <div>
        <label className="block mb-2 font-medium">
          Language
        </label>

        <input
          className="w-full border rounded-xl p-3"
          value={data.language}
          onChange={(e) =>
            onChange("language", e.target.value)
          }
        />
      </div>

      <div>
        <label className="block mb-2 font-medium">
          Target Country
        </label>

        <input
          className="w-full border rounded-xl p-3"
          value={data.targetCountry}
          onChange={(e) =>
            onChange("targetCountry", e.target.value)
          }
        />
      </div>

      <div>
        <label className="block mb-2 font-medium">
          Target Audience
        </label>

        <textarea
          className="w-full border rounded-xl p-3 h-28"
          value={data.targetAudience}
          onChange={(e) =>
            onChange("targetAudience", e.target.value)
          }
        />
      </div>

    </div>
  );
}