import { handleRequestResourceCommand } from "@/libs/resource-request/commands";

export async function POST(request: Request) {
  return handleRequestResourceCommand(request);
}
