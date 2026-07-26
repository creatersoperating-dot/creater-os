import { chat } from "@/services/ai/chatService";
import { Brand } from "@/types/brand";

export async function POST(req: Request) {
  try {
    const {
      message,
      brand,
    }: {
      message: string;
      brand: Brand;
    } = await req.json();
    console.log("Message:", message);
console.log("Brand:", brand);

    const result = await chat(message, brand);

    return result.toTextStreamResponse();
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: "AI request failed.",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}