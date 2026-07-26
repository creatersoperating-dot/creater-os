"use client";

import { useState } from "react";
import { Brand } from "@/types/brand";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { getBrands } from "@/services/brandService";
import BrandCard from "@/components/channels/BrandCard";
import Modal from "@/components/ui/Modal";
import BrandForm from "@/components/brands/BrandWizard";

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>(getBrands());
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCreateBrand = (data: {
    name: string;
    description: string;
  }) => {
    const now = new Date().toISOString();

    const newBrand: Brand = {
      // Identity
      id: Date.now().toString(),
      name: data.name,
      tagline: "",
      description: data.description,
      logo: "",
      website: "",

      // Audience
      primaryPlatform: "YouTube",
      language: "English",
      targetCountry: "Global",
      targetAudience: "",
      ageGroup: "",
      experienceLevel: "",

      // Strategy
      primaryNiche: "General",
      subNiche: "",
      contentPillars: [],
      keywords: [],
      competitors: [],
      uniqueValueProposition: "",

      // Content
      postingFrequency: "",
      preferredFormats: [],
      contentGoals: [],
      contentStyle: "",

      // Brand Voice
      tone: "Professional",
      personality: "",
      writingStyle: "",
      preferredWords: [],
      forbiddenWords: [],
      emojiStyle: "",

      // Business
      monetizationGoal: "",
      revenueStreams: [],
      targetSubscribers: 0,
      targetRevenue: 0,

      // AI Knowledge
      mission: "",
      vision: "",
      coreValues: [],
      thingsToAvoid: [],
      brandRules: [],
      importantContext: "",

      // Metadata
      status: "Draft",
      createdAt: now,
      updatedAt: now,
    };

    setBrands((prev) => [...prev, newBrand]);
    setIsModalOpen(false);
  };

  return (
    <DashboardLayout>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">Your Brands</h1>

        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 text-white px-5 py-3 rounded-xl"
        >
          + Create Brand
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {brands.map((brand) => (
          <BrandCard
            key={brand.id}
            brand={brand}
          />
        ))}
      </div>

      <Modal
        open={isModalOpen}
        title="Create Brand"
        onClose={() => setIsModalOpen(false)}
      >
        <BrandForm onSubmit={handleCreateBrand} />
      </Modal>
    </DashboardLayout>
  );
}