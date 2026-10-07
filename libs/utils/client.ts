import type {
  SlackApiResponse,
  SlackBlock,
  SlackMember,
  SlackMembersPage,
  SlackModal,
  SlackUser,
  SlackUserInfoResponse,
} from "@/models/slack-api";

// Plain fields, not constructor parameter properties, so `node --test` can load
// this file with type stripping alone.
class SlackApiError extends Error {
  readonly method: string;
  readonly slackError: string;
  readonly needed?: string;
  readonly provided?: string;

  constructor(
    method: string,
    slackError: string,
    needed?: string,
    provided?: string,
  ) {
    super(
      `${method} failed: ${slackError}${needed ? ` (needs ${needed})` : ""}`,
    );
    this.name = "SlackApiError";
    this.method = method;
    this.slackError = slackError;
    this.needed = needed;
    this.provided = provided;
  }
}

function getBotToken() {
  const token = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is not configured");
  }

  return token;
}

async function callSlack<T extends SlackApiResponse>(
  method: string,
  // Slack reads JSON bodies only on write methods. Read methods ignore them, which
  // left users.info without its `user` argument and answering user_not_found, so
  // read methods take URLSearchParams, the form encoding every method accepts.
  body: Record<string, unknown> | URLSearchParams,
) {
  const isForm = body instanceof URLSearchParams;
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getBotToken()}`,
      ...(isForm ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    },
    body: isForm ? body : JSON.stringify(body),
  });
  const result = (await response.json()) as T;

  if (!response.ok || !result.ok) {
    throw new SlackApiError(
      method,
      result.error ?? `HTTP ${response.status}`,
      result.needed,
      result.provided,
    );
  }

  return result;
}

export async function openSlackModal(triggerId: string, view: SlackModal) {
  await callSlack("views.open", { trigger_id: triggerId, view });
}

export async function updateSlackModal(viewId: string, view: SlackModal) {
  await callSlack("views.update", { view_id: viewId, view });
}

export async function postSlackMessage(
  channel: string,
  message: { text: string; blocks: SlackBlock[] },
  threadTs?: string,
) {
  // JSON.stringify drops thread_ts when it is undefined, so the same call serves
  // both a top-level post and a threaded reply.
  await callSlack("chat.postMessage", {
    channel,
    ...message,
    thread_ts: threadTs,
  });
}

export async function scheduleSlackMessage(
  channel: string,
  message: { text: string; blocks: SlackBlock[] },
  postAt: number,
  threadTs?: string,
) {
  const result = await callSlack<
    SlackApiResponse & { scheduled_message_id?: string }
  >("chat.scheduleMessage", {
    channel,
    post_at: postAt,
    ...message,
    thread_ts: threadTs,
  });

  return result.scheduled_message_id;
}

// false means Slack no longer holds it: already posted, already cancelled, or inside
// the final minute before post_at, when Slack stops allowing deletes.
export async function deleteScheduledSlackMessage(
  channel: string,
  scheduledMessageId: string,
) {
  try {
    await callSlack("chat.deleteScheduledMessage", {
      channel,
      scheduled_message_id: scheduledMessageId,
    });

    return true;
  } catch (error) {
    if (
      error instanceof SlackApiError &&
      error.slackError === "invalid_scheduled_message_id"
    ) {
      return false;
    }

    throw error;
  }
}

export async function updateSlackMessage(
  channel: string,
  ts: string,
  message: { text: string; blocks: SlackBlock[] },
) {
  await callSlack("chat.update", { channel, ts, ...message });
}

export async function deleteSlackMessage(channel: string, ts: string) {
  await callSlack("chat.delete", { channel, ts });
}

export async function postSlackEphemeral(
  channel: string,
  user: string,
  text: string,
) {
  await callSlack("chat.postEphemeral", { channel, user, text });
}

function slackUserName(user: SlackUser | undefined) {
  return (
    user?.profile?.display_name ||
    user?.profile?.real_name ||
    user?.real_name ||
    user?.name
  );
}

async function listSlackPages<T>(method: string, params: Record<string, string>) {
  const items: T[] = [];
  let cursor = "";

  do {
    const query = new URLSearchParams(params);

    if (cursor) {
      query.set("cursor", cursor);
    }

    const page = await callSlack<SlackMembersPage<T>>(method, query);
    items.push(...(page.members ?? []));
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (cursor);

  return items;
}

export async function listSlackChannelMembers(
  channelId: string,
): Promise<SlackMember[]> {
  // ponytail: users.list walks the whole workspace on every sync; switch to
  // users.info per channel member if a big workspace hits its rate limit.
  const [memberIds, users] = await Promise.all([
    listSlackPages<string>("conversations.members", {
      channel: channelId,
      limit: "1000",
    }),
    listSlackPages<SlackUser>("users.list", { limit: "200" }),
  ]);
  const inChannel = new Set(memberIds);

  return users.flatMap((user) => {
    const name = slackUserName(user);

    return user.id && inChannel.has(user.id) && !user.deleted && !user.is_bot && name
      ? [{ id: user.id, name }]
      : [];
  });
}

export async function getSlackMember(
  userId: string | undefined,
  source: string,
): Promise<SlackMember | null> {
  if (!userId) {
    return null;
  }

  try {
    const result = await callSlack<SlackUserInfoResponse>(
      "users.info",
      new URLSearchParams({ user: userId }),
    );
    const name = slackUserName(result.user);

    if (!name) {
      return null;
    }

    return {
      id: result.user?.id ?? userId,
      name,
    };
  } catch (error) {
    if (error instanceof SlackApiError && error.slackError === "user_not_found") {
      return null;
    }

    if (error instanceof SlackApiError) {
      console.error("Unable to fetch Slack member", {
        source,
        method: error.method,
        error: error.slackError,
        needed: error.needed,
        provided: error.provided,
      });
    } else {
      console.error("Unable to fetch Slack member", {
        source,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return null;
  }
}
