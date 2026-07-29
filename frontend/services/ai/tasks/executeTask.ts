import { ExecuteTaskRequest } from "./taskTypes";
import { executeBrain } from "../brain/executeBrain";

export async function executeTask(
  request: ExecuteTaskRequest
) {
  return executeBrain(request);
}