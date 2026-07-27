import { chat } from "@/services/ai/chatService";
import { Brand } from "@/types/brand";

export async function POST(req: Request) {
  try {
    const {
      message,
      brand,
      sessionId,
    }: {
      message: string;
      brand: Brand;
      sessionId: string;
    } = await req.json();

    console.log("Message:", message);
    console.log("Brand:", brand.name);
    console.log("Session:", sessionId);

    const result = await chat(
      message,
      brand,
      sessionId
    );

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("API ERROR:", error);

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