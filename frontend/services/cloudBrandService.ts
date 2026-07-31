"use client";

import { createClient } from "@/lib/supabase/client";
import type { Brand } from "@/types/brand";
import {
  type BrandRow,
  mapBrandRowToBrand,
  mapBrandToRow,
} from "./brandMapper";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

async function requireAuthenticatedUser(
  supabase: SupabaseBrowserClient = createClient(),
) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("Authentication required.");
  }

  return user;
}

export async function getCloudBrands(): Promise<Brand[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return ((data ?? []) as BrandRow[]).map(mapBrandRowToBrand);
}

export async function getCloudBrandById(
  id: string,
): Promise<Brand | null> {
  const supabase = createClient();
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

export async function saveCloudBrand(brand: Brand): Promise<Brand> {
  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const row = mapBrandToRow(brand, user.id);
  const { data, error } = await supabase
    .from("brands")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapBrandRowToBrand(data as BrandRow);
}

export async function updateCloudBrand(brand: Brand): Promise<Brand> {
  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const row = mapBrandToRow(brand, user.id);
  const { data, error } = await supabase
    .from("brands")
    .update(row)
    .eq("user_id", user.id)
    .eq("id", brand.id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return mapBrandRowToBrand(data as BrandRow);
}

export async function deleteCloudBrand(id: string): Promise<void> {
  const supabase = createClient();
  const user = await requireAuthenticatedUser(supabase);
  const { error } = await supabase
    .from("brands")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);

  if (error) {
    throw error;
  }
}
