import { handleBorrowedCommand } from "@/libs/resource-request/commands";

export async function POST(request: Request) {
  return handleBorrowedCommand(request);
}
