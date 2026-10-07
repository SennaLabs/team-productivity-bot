import {
  listChannelMembers,
  saveChannelMembers,
} from "@/libs/repositories/channel-repository";
import { getSessionUser, unauthorizedResponse } from "@/libs/auth/session";
import { listSlackChannelMembers } from "@/libs/utils/client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  if (!(await getSessionUser())) {
    return unauthorizedResponse();
  }

  try {
    const { channelId } = await params;

    const members = await listChannelMembers(channelId);

    return Response.json({ members: members.filter((member) => member.active) });
  } catch (error) {
    console.error("Unable to list Channel Members", error);
    return Response.json(
      { error: "Unable to list Channel Members" },
      { status: 500 },
    );
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  if (!(await getSessionUser())) {
    return unauthorizedResponse();
  }

  try {
    const { channelId } = await params;

    await saveChannelMembers(
      channelId,
      await listSlackChannelMembers(channelId),
    );

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Unable to sync Channel Members", error);
    // The Slack error names any missing scope, which is what the person needs to fix.
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to sync Channel Members",
      },
      { status: 502 },
    );
  }
}
