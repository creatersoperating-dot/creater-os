import { chat } from "@/services/ai/chatService";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    console.log("Incoming message:", message);

    const result = await chat(message);

    let text = "";

    for await (const chunk of result.textStream) {
      console.log("Chunk:", chunk);
      text += chunk;
    }

    console.log("Final text:", text);

    return new Response(text, {
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (error) {
    console.error("API ERROR:", error);

    return new Response("ERROR", {
      status: 500,
    });
  }
}