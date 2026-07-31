"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function readStringField(
  formData: FormData,
  fieldName: string
): string {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value.trim() : "";
}

function validateCredentials(
  email: string,
  password: string
): void {
  if (!email) {
    redirect(
      `/login?error=${encodeURIComponent("Email is required.")}`
    );
  }

  if (password.length < 6) {
    redirect(
      `/login?error=${encodeURIComponent(
        "Password must be at least 6 characters."
      )}`
    );
  }
}

export async function login(formData: FormData) {
  const email = readStringField(formData, "email");
  const password = readStringField(formData, "password");

  validateCredentials(email, password);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(
      `/login?error=${encodeURIComponent(error.message)}`
    );
  }

  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const email = readStringField(formData, "email");
  const password = readStringField(formData, "password");

  validateCredentials(email, password);

  const requestHeaders = await headers();
  const origin =
    requestHeaders.get("origin")?.trim() ||
    "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    redirect(
      `/login?error=${encodeURIComponent(error.message)}`
    );
  }

  if (data.session) {
    redirect("/dashboard");
  }

  redirect(
    `/login?message=${encodeURIComponent(
      "Check your email to confirm your account, then sign in."
    )}`
  );
}
