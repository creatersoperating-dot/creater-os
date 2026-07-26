import { Brand } from "@/types/brand";
import { runAI } from "./router";

export async function chat(
  message: string,
  brand: Brand
) {
  return runAI({
    provider: "gemini",
    prompt: message,
    brand,
  });
}