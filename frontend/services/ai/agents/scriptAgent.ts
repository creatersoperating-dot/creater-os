import { Capability } from "../capabilities/capabilities";
import { executeTask } from "../tasks/executeTask";
import type { Brand } from "@/types/brand";

export async function generateScript(
  brand: Brand,
  topic: string,
  sessionId: string
) {
  return executeTask({
    capability: Capability.SCRIPT_WRITING,
    input: topic,
    brand,
    sessionId,
  });
}
