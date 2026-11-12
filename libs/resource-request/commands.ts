import { after } from "next/server";
import { openCreateModal } from "@/libs/resource-request/interactions";
import { createBorrowedMessage } from "@/libs/resource-request/messages";
import {
  getResourceRequestSettings,
  monthOf,
  summarizeBorrowed,
} from "@/libs/resource-request/requests";
import { listResourceRequestsEndingFrom } from "@/libs/repositories/resource-request-repository";
import { respondToSlackCommand } from "@/libs/utils/client";
import { getCalendarDate, isValidSlackRequest } from "@/libs/utils/requests";
import type { DateRange } from "@/models/resource-request";

const BORROWED_HELP =
  "ใช้ได้แบบนี้:\n" +
  "• `/borrowed` ใครถูกยืมอยู่หรือจะถูกยืม ตั้งแต่วันนี้เป็นต้นไป\n" +
  "• `/borrowed month` ใครถูกยืมในเดือนนี้ (รวมที่จบไปแล้ว)";

function ephemeral(text: string) {
  return Response.json({ response_type: "ephemeral", text });
}

async function readCommand(request: Request) {
  const rawBody = await request.text();

  return isValidSlackRequest(request, rawBody) ? new URLSearchParams(rawBody) : null;
}

// /request-resource: opens the form to borrow a person.
export async function handleRequestResourceCommand(request: Request) {
  const form = await readCommand(request);

  if (!form) {
    return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  const triggerId = form.get("trigger_id");

  if (!triggerId) {
    return Response.json({ error: "trigger_id is required" }, { status: 400 });
  }

  if (!getResourceRequestSettings().channelId) {
    return ephemeral(":warning: ยังไม่ได้ตั้ง RESOURCE_REQUEST_CHANNEL_ID แจ้งแอดมินก่อนนะ");
  }

  try {
    await openCreateModal(triggerId);
  } catch (error) {
    console.error("Resource request: create modal failed to open", error);
    return ephemeral(":warning: เปิดฟอร์มไม่สำเร็จ ลองใหม่อีกครั้ง");
  }

  return new Response(null, { status: 200 });
}

// /borrowed: who is lent out to which project, and for how many mandays. Reads
// Firestore, so the reply goes through response_url after the 3-second window.
export async function handleBorrowedCommand(request: Request) {
  const form = await readCommand(request);

  if (!form) {
    return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  const argument = form.get("text")?.trim().toLowerCase() ?? "";
  const responseUrl = form.get("response_url");
  const { date: today } = getCalendarDate(undefined);
  let range: DateRange;
  let title: string;

  if (argument === "") {
    range = { start: today, end: "9999-12-31" };
    title = `คนที่ถูกยืม ตั้งแต่วันนี้ (${today}) เป็นต้นไป`;
  } else if (argument === "month") {
    range = monthOf(today);
    title = `คนที่ถูกยืมในเดือนนี้ (${range.start} → ${range.end})`;
  } else {
    return ephemeral(BORROWED_HELP);
  }

  if (!responseUrl) {
    return Response.json({ error: "response_url is required" }, { status: 400 });
  }

  after(async () => {
    try {
      const requests = await listResourceRequestsEndingFrom(range.start);

      await respondToSlackCommand(
        responseUrl,
        createBorrowedMessage(summarizeBorrowed(requests, range), title),
      );
    } catch (error) {
      console.error("Resource request: /borrowed failed", error);
      await respondToSlackCommand(responseUrl, {
        text: ":warning: ดึงข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง",
      }).catch(() => undefined);
    }
  });

  return new Response(null, { status: 200 });
}
