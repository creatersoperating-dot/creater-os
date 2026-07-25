"use client";

import { useState } from "react";

interface BrandFormProps {
  onSubmit: (brand: {
    name: string;
    description: string;
  }) => void;
}

export default function BrandForm({
  onSubmit,
}: BrandFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="space-y-5">
      <div>
        <label className="block font-medium mb-2">
          Brand Name
        </label>

        <input
          className="w-full border rounded-lg p-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tech Explained"
        />
      </div>

      <div>
        <label className="block font-medium mb-2">
          Description
        </label>

        <textarea
          className="w-full border rounded-lg p-3 h-32"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe your brand..."
        />
      </div>

      <button
        type="button"
        onClick={() =>
          onSubmit({
            name,
            description,
          })
        }
        className="bg-blue-600 text-white px-5 py-3 rounded-xl"
      >
        Save Brand
      </button>
    </div>
  );
}