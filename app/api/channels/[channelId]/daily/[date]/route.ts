import {
  deleteDailySubmission,
  saveDashboardDailyTime,
} from "@/libs/repositories/channel-repository";
import { getSessionUser, unauthorizedResponse } from "@/libs/auth/session";
import { getMinutesSinceMidnight } from "@/libs/utils/requests";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ channelId: string; date: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return unauthorizedResponse();
  }

  const { channelId, date } = await params;
  const body = (await request.json().catch(() => null)) as {
    startTime?: unknown;
    endTime?: unknown;
    note?: unknown;
  } | null;
  const startTime = body?.startTime;
  const endTime = body?.endTime;
  const note = body?.note ?? "";

  if (
    !DATE_PATTERN.test(date) ||
    typeof startTime !== "string" ||
    typeof endTime !== "string" ||
    typeof note !== "string" ||
    !TIME_PATTERN.test(startTime) ||
    !TIME_PATTERN.test(endTime)
  ) {
    return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  const durationMinutes =
    getMinutesSinceMidnight(endTime) - getMinutesSinceMidnight(startTime);

  if (durationMinutes <= 0) {
    return Response.json(
      { error: "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น" },
      { status: 400 },
    );
  }

  try {
    await saveDashboardDailyTime(
      channelId,
      date,
      { startTime, endTime, durationMinutes, note: note.trim() || null },
      user.name ?? user.email,
    );

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Unable to save Daily submission", error);
    return Response.json(
      { error: "Unable to save Daily submission" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ channelId: string; date: string }> },
) {
  if (!(await getSessionUser())) {
    return unauthorizedResponse();
  }

  const { channelId, date } = await params;

  if (!DATE_PATTERN.test(date)) {
    return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    await deleteDailySubmission(channelId, date);

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Unable to delete Daily submission", error);
    return Response.json(
      { error: "Unable to delete Daily submission" },
      { status: 500 },
    );
  }
}
