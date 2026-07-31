import { createClient } from "@/lib/supabase/server";
import type { Brand } from "@/types/brand";
import {
  type BrandRow,
  mapBrandRowToBrand,
} from "./brandMapper";

export async function getServerCloudBrandById(
  id: string,
): Promise<Brand | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? mapBrandRowToBrand(data as BrandRow) : null;
}
