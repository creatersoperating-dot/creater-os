"use client";

import { useState } from "react";
import { Brand } from "@/types/brand";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { getBrands } from "@/services/brandService";
import BrandCard from "@/components/channels/BrandCard";
import Modal from "@/components/ui/Modal";
import BrandForm from "@/components/brands/BrandForm";

export default function ChannelsPage() {
  const [brands, setBrands] = useState<Brand[]>(getBrands());
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCreateBrand = (data: {
    name: string;
    description: string;
  }) => {
    const newBrand: Brand = {
      id: Date.now().toString(),
      name: data.name,
      description: data.description,
      primaryPlatform: "YouTube",
      language: "English",
      targetCountry: "Global",
      niche: "General",
      subNiche: "",
      contentPillars: [],
      targetAudience: "",
      tone: "Professional",
      monetizationGoal: "",
      status: "Draft",
      createdAt: new Date().toISOString(),
    };

    setBrands((prev) => [...prev, newBrand]);
    setIsModalOpen(false);
  };

  return (
    <DashboardLayout>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">Your Channels</h1>

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