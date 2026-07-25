import { brands } from "@/lib/brandData";
import { Brand } from "@/types/brand";

export function getBrands(): Brand[] {
  return brands;
}