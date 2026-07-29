import type { Brand } from "@/types/brand";
import type { Capability } from "../capabilities/capabilities";

export interface ExecuteTaskRequest {
  capability: Capability;

  input: string;

  brand: Brand;

  sessionId: string;
}
