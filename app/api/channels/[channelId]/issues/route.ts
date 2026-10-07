import {
  getChannel,
  listChannelMembers,
  listIssueSubmissions,
  newIssueSubmissionId,
  saveIssueSubmission,
} from "@/libs/repositories/channel-repository";
import { getSessionUser, unauthorizedResponse } from "@/libs/auth/session";
import { getCalendarDate } from "@/libs/utils/requests";

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  if (!(await getSessionUser())) {
    return unauthorizedResponse();
  }

  try {
    const { channelId } = await params;

    return Response.json({
      issues: await listIssueSubmissions(channelId),
    });
  } catch (error) {
    console.error("Unable to list Issue submissions", error);
    return Response.json(
      { error: "Unable to list Issue submissions" },
      { status: 500 },
    );
  }
}

// Dashboard issues are saved, not posted to Slack: the Company Member has no Slack
// ID, so the post's owner-only Delete would lock everyone out.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const user = await getSessionUser();

  if (!user) {
    return unauthorizedResponse();
  }

  const { channelId } = await params;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const problem = optionalText(body?.problem);
  const blocking = optionalText(body?.blocking);
  const need = optionalText(body?.need);
  const askUserIds = body?.askUserIds;
  const minutes = body?.minutes;

  if (
    !problem ||
    !blocking ||
    !need ||
    !Array.isArray(askUserIds) ||
    !askUserIds.length ||
    typeof minutes !== "number" ||
    !Number.isInteger(minutes) ||
    minutes <= 0
  ) {
    return Response.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const [channel, members] = await Promise.all([
      getChannel(channelId),
      listChannelMembers(channelId),
    ]);
    const memberNames = new Map(
      members.map((member) => [member.userId, member.userName]),
    );

    if (!channel) {
      return Response.json({ error: "ไม่พบ Channel" }, { status: 404 });
    }

    if (!askUserIds.every((userId) => memberNames.has(userId))) {
      return Response.json(
        { error: "Ask ต้องเป็นสมาชิกใน Channel กด Sync members แล้วลองใหม่" },
        { status: 400 },
      );
    }

    const { date: createdDate, timezone } = getCalendarDate(undefined);

    await saveIssueSubmission(
      {
        channel: { channelId, channelName: channel.channelName },
        userName: user.name ?? user.email,
        problem,
        blocking,
        askUserIds,
        askUserNames: askUserIds.map(
          (userId: string) => memberNames.get(userId) ?? userId,
        ),
        need,
        minutes,
        note: optionalText(body?.note),
        createdDate,
        timezone,
      },
      newIssueSubmissionId(channelId),
    );

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Unable to save Issue submission", error);
    return Response.json(
      { error: "Unable to save Issue submission" },
      { status: 500 },
    );
  }
}
