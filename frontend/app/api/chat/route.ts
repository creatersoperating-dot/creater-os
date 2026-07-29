import { executeTask } from "@/services/ai/tasks/executeTask";
import { Capability } from "@/services/ai/capabilities/capabilities";
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

    const result = await executeTask({
      capability: Capability.CHAT,
      input: message,
      brand,
      sessionId,
    });

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
