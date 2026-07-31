"use client";

import { useEffect, useState } from "react";
import { Brand } from "@/types/brand";
import DashboardLayout from "@/components/layout/DashboardLayout";
import {
  getCloudBrands,
  saveCloudBrand,
} from "@/services/cloudBrandService";
import BrandCard from "@/components/channels/BrandCard";
import Modal from "@/components/ui/Modal";
import BrandForm from "@/components/brands/BrandWizard";

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadBrands() {
      try {
        const cloudBrands = await getCloudBrands();

        if (isMounted) {
          setBrands(cloudBrands);
        }
      } catch {
        if (isMounted) {
          setError("Unable to load brands. Please try again.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadBrands();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleCreateBrand = async (data: Brand) => {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);

    const timestamp = new Date().toISOString();

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

    const brandToSave: Brand = {
      ...newBrand,
      ...data,
      id: crypto.randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      const savedBrand = await saveCloudBrand(brandToSave);
      setBrands((currentBrands) => [savedBrand, ...currentBrands]);
      setIsModalOpen(false);
    } catch {
      setError("Unable to create brand. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DashboardLayout>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {isLoading && (
        <p className="mb-4 text-sm text-gray-600">Loading brands...</p>
      )}
      {!isLoading && brands.length === 0 && (
        <p className="mb-4 text-sm text-gray-600">
          No brands yet. Create your first brand to get started.
        </p>
      )}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">Your Brands</h1>

          <button
            onClick={() => setIsModalOpen(true)}
            disabled={isSaving}
          className="bg-blue-600 text-white px-5 py-3 rounded-xl"
        >
            {isSaving ? "Creating..." : "+ Create Brand"}
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
