import { brands } from "@/lib/brandData";
import { Brand } from "@/types/brand";

let brandStore: Brand[] = [...brands];

export function getBrands(): Brand[] {
  return brandStore;
}

export function getBrandById(id: string): Brand | undefined {
  return brandStore.find((brand) => brand.id === id);
}

export function saveBrand(brand: Brand): void {
  brandStore.push(brand);
}

export function updateBrand(updatedBrand: Brand): void {
  brandStore = brandStore.map((brand) =>
    brand.id === updatedBrand.id ? updatedBrand : brand
  );
}

export function deleteBrand(id: string): void {
  brandStore = brandStore.filter((brand) => brand.id !== id);
}