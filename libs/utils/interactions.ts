import { after } from "next/server";
import {
  createDailyMessage,
  createIssueMessage,
  createPrMergedMessage,
  createPrMergedUpdate,
  createPrMessage,
  createPrScheduleClosedUpdate,
  createPrScheduledNotice,
  decodeActionValue,
  decodeWatcherUserIds,
  parsePrPriority,
  isMessageOwner,
  MAX_WATCHER_COUNT,
} from "@/libs/messages";
import { createIssueModal } from "@/libs/modals";
import type {
  DailySubmission,
  IssueSubmission,
  PrSubmission,
  SlackInteractionPayload,
} from "@/models/slack-api";
import {
  deleteScheduledSlackMessage,
  deleteSlackMessage,
  getSlackMember,
  openSlackModal,
  postSlackEphemeral,
  postSlackMessage,
  scheduleSlackMessage,
  updateSlackMessage,
} from "@/libs/utils/client";
import {
  deleteIssueSubmission,
  newIssueSubmissionId,
  saveDailySubmission,
  saveIssueSubmission,
} from "@/libs/repositories/channel-repository";
import {
  getChannelContext,
  getCalendarDate,
  getInput,
  getMinutesSinceMidnight,
  getRequesterUserId,
  getRequesterUserName,
  getThreadTs,
  isValidSlackRequest,
  parsePrUrl,
  parseInteractionPayload,
  parsePositiveInteger,
  resolvePrPostAt,
  splitTicketLinks,
} from "@/libs/utils/requests";
import {
  resolveSubmissionIdentity,
  resolveSubmissionUserName,
} from "@/libs/utils/slack-identity";

async function publishDaily(submission: DailySubmission) {
  if (!submission.channel.channelId) {
    throw new Error("Channel ID is missing from private_metadata");
  }

  const member = await getSlackMember(submission.userId, "daily_submitter");
  const enrichedSubmission = {
    ...submission,
    userName: resolveSubmissionUserName(member?.name, submission.userName),
  };

  await Promise.all([
    postSlackMessage(
      submission.channel.channelId,
      createDailyMessage(enrichedSubmission),
    ),
    saveDailySubmission(enrichedSubmission),
  ]);
}

async function publishIssue(submission: IssueSubmission, threadTs?: string) {
  const channelId = submission.channel.channelId;

  if (!channelId) {
    throw new Error("Channel ID is missing from private_metadata");
  }

  const issueId = newIssueSubmissionId(channelId);
  const [submittedBy, askedMembers] = await Promise.all([
    getSlackMember(submission.userId, "issue_submitter"),
    Promise.all(
      submission.askUserIds.map((userId) =>
        getSlackMember(userId, "issue_ask_member"),
      ),
    ),
  ]);
  const enrichedSubmission = {
    ...submission,
    userName: resolveSubmissionUserName(
      submittedBy?.name,
      submission.userName,
    ),
    askUserNames: askedMembers.map(
      (member, index) => member?.name ?? submission.askUserIds[index],
    ),
  };

  await Promise.all([
    postSlackMessage(
      channelId,
      createIssueMessage(enrichedSubmission, issueId),
      threadTs,
    ),
    saveIssueSubmission(enrichedSubmission, issueId),
  ]);
}

async function publishPr(submission: PrSubmission, postAt: number | null) {
  const channelId = submission.channel.channelId;

  if (!channelId) {
    throw new Error("Channel ID is missing from private_metadata");
  }

  // ponytail: nothing is stored and no dashboard reads this, so <@id> mentions are
  // enough — skips the users.info fan-out publishIssue needs for saved display names.
  const message = createPrMessage(submission);

  if (postAt === null) {
    await postSlackMessage(channelId, message);
    return;
  }

  const scheduledMessageId = await scheduleSlackMessage(
    channelId,
    message,
    postAt,
  );

  // The scheduled_message_id exists nowhere else, so the creator's DM with the bot
  // holds it on the Cancel button. Only they can see that DM, so the button needs
  // no owner check. See docs/adr/0003.
  if (submission.userId && scheduledMessageId) {
    await postSlackMessage(
      submission.userId,
      createPrScheduledNotice(submission, postAt, scheduledMessageId),
    );
  }
}

function runAfterResponse(task: () => Promise<void>) {
  after(async () => {
    try {
      await task();
    } catch (error) {
      console.error("Slack submission publish failed", error);
    }
  });
}

function getSubmissionIdentity(payload: SlackInteractionPayload) {
  return resolveSubmissionIdentity(
    getRequesterUserId(payload),
    getRequesterUserName(payload),
    payload.user,
  );
}

function handleDailySubmission(payload: SlackInteractionPayload) {
  const startTimeInput = getInput(payload, "start_time", "start_time_input");
  const startTime = startTimeInput?.selected_time;
  const endTime = getInput(
    payload,
    "end_time",
    "end_time_input",
  )?.selected_time;

  if (
    !startTime ||
    !endTime ||
    getMinutesSinceMidnight(endTime) <= getMinutesSinceMidnight(startTime)
  ) {
    return Response.json({
      response_action: "errors",
      errors: { end_time: "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น" },
    });
  }

  const calendarDate = getCalendarDate(startTimeInput?.timezone);

  const identity = getSubmissionIdentity(payload);
  const submission: DailySubmission = {
    channel: getChannelContext(payload),
    ...identity,
    startTime,
    endTime,
    durationMinutes:
      getMinutesSinceMidnight(endTime) - getMinutesSinceMidnight(startTime),
    ...calendarDate,
  };

  runAfterResponse(() => publishDaily(submission));

  return new Response(null, { status: 200 });
}

function handleIssueSubmission(payload: SlackInteractionPayload) {
  const rawMinutes = getInput(payload, "time", "time_input")?.value;
  const minutes = parsePositiveInteger(rawMinutes);

  if (minutes === null) {
    return Response.json({
      response_action: "errors",
      errors: {
        time: "กรุณาระบุจำนวนนาทีเป็นเลขจำนวนเต็มที่มากกว่า 0 เช่น 15",
      },
    });
  }

  const identity = getSubmissionIdentity(payload);
  const { date: createdDate, timezone } = getCalendarDate(undefined);
  const submission: IssueSubmission = {
    channel: getChannelContext(payload),
    ...identity,
    problem: getInput(payload, "problem", "problem_input")?.value,
    blocking: getInput(payload, "blocking", "blocking_input")?.value,
    askUserIds:
      getInput(payload, "ask", "ask_select")?.selected_users ?? [],
    need: getInput(payload, "need", "need_input")?.value,
    minutes,
    note: getInput(payload, "note", "note_input")?.value,
    createdDate,
    timezone,
  };

  runAfterResponse(() => publishIssue(submission, getThreadTs(payload)));

  return new Response(null, { status: 200 });
}

async function handleIssueShortcut(payload: SlackInteractionPayload) {
  const triggerId = payload.trigger_id;
  // Run on a reply, the shortcut still targets that reply's thread rather than
  // starting a new thread under the reply.
  const threadTs = payload.message?.thread_ts ?? payload.message?.ts;

  if (!triggerId || !threadTs) {
    return new Response(null, { status: 200 });
  }

  try {
    await openSlackModal(
      triggerId,
      createIssueModal({
        channel: {
          channelId: payload.channel?.id ?? null,
          channelName: payload.channel?.name ?? null,
        },
        requesterUserId: payload.user?.id ?? null,
        requesterUserName: payload.user?.name ?? null,
        threadTs,
      }),
    );
  } catch (error) {
    // Slack shows nothing from a message_action response body, so the 502 that
    // /issue returns would be invisible here.
    console.error("Issue shortcut modal failed to open", error);
  }

  return new Response(null, { status: 200 });
}

function handlePrSubmission(payload: SlackInteractionPayload) {
  const prUrl = parsePrUrl(getInput(payload, "pr_link", "pr_link_input")?.value);

  if (!prUrl) {
    return Response.json({
      response_action: "errors",
      errors: {
        pr_link: "กรุณาใส่ลิงก์ที่ขึ้นต้นด้วย http:// หรือ https://",
      },
    });
  }

  const watcherUserIds =
    getInput(payload, "watcher", "watcher_select")?.selected_users ?? [];

  if (watcherUserIds.length > MAX_WATCHER_COUNT) {
    return Response.json({
      response_action: "errors",
      errors: {
        watcher: `เลือก watcher ได้ไม่เกิน ${MAX_WATCHER_COUNT} คน`,
      },
    });
  }

  const schedule = resolvePrPostAt(
    getInput(payload, "send_at", "send_at_select")?.selected_option?.value,
    getInput(payload, "send_custom", "send_custom_input")?.selected_date_time,
  );

  if ("error" in schedule) {
    return Response.json({
      response_action: "errors",
      errors: { send_custom: schedule.error },
    });
  }

  const submission: PrSubmission = {
    channel: getChannelContext(payload),
    ...getSubmissionIdentity(payload),
    ticketLinks: splitTicketLinks(
      getInput(payload, "ticket_link", "ticket_link_input")?.value,
    ),
    prUrl,
    priority: parsePrPriority(
      getInput(payload, "priority", "priority_select")?.selected_option?.value,
    ),
    reviewerUserIds:
      getInput(payload, "reviewer", "reviewer_select")?.selected_users ?? [],
    watcherUserIds,
  };

  runAfterResponse(() => publishPr(submission, schedule.postAt));

  return new Response(null, { status: 200 });
}

function handleMessageAction(payload: SlackInteractionPayload) {
  const action = payload.actions?.[0];
  const channelId = payload.channel?.id;
  // The button lives on the parent message, so its ts is also the thread to reply in.
  const messageTs = payload.message?.ts;

  if (!action?.action_id || !channelId || !messageTs) {
    return new Response(null, { status: 200 });
  }

  const clickedByUserId = payload.user?.id;
  const selected = decodeActionValue(action.selected_option?.value ?? action.value);

  if (!selected) {
    return new Response(null, { status: 200 });
  }

  const rejectNonOwner = (what: string) => {
    if (clickedByUserId) {
      runAfterResponse(() =>
        postSlackEphemeral(
          channelId,
          clickedByUserId,
          `ลบได้เฉพาะเจ้าของ ${what} เท่านั้น`,
        ),
      );
    }

    return new Response(null, { status: 200 });
  };

  if (action.action_id === "pr_merged" && selected.action === "merged") {
    const watcherUserIds = decodeWatcherUserIds(selected.fields[0]);

    runAfterResponse(async () => {
      const tasks = [
        // The ✅ marker this leaves behind is what tells the channel the PR is in,
        // and it is also what removes the Merged option from the menu.
        // ponytail: two picks in the same instant can still both land — a lock
        // would cost more than the stray thread reply it would prevent.
        updateSlackMessage(
          channelId,
          messageTs,
          createPrMergedUpdate(payload.message ?? {}, clickedByUserId),
        ),
      ];

      // With nobody to mention, the ✅ marker above already says it all and a
      // thread reply would just be noise.
      if (watcherUserIds.length) {
        tasks.push(
          postSlackMessage(
            channelId,
            createPrMergedMessage(watcherUserIds),
            messageTs,
          ),
        );
      }

      await Promise.all(tasks);
    });

    return new Response(null, { status: 200 });
  }

  if (action.action_id === "pr_schedule_cancel" && selected.action === "cancel") {
    const [targetChannelId, scheduledMessageId] = selected.fields;

    if (!targetChannelId || !scheduledMessageId) {
      return new Response(null, { status: 200 });
    }

    runAfterResponse(async () => {
      const cancelled = await deleteScheduledSlackMessage(
        targetChannelId,
        scheduledMessageId,
      );

      await updateSlackMessage(
        channelId,
        messageTs,
        createPrScheduleClosedUpdate(
          payload.message ?? {},
          cancelled
            ? ":x: *ยกเลิกแล้ว*"
            : ":information_source: โพสต์ไปแล้ว ใช้ Delete ที่ข้อความแทน",
        ),
      );
    });

    return new Response(null, { status: 200 });
  }

  if (action.action_id === "pr_overflow" && selected.action === "delete") {
    if (!isMessageOwner(selected.fields[0], clickedByUserId)) {
      return rejectNonOwner("PR");
    }

    runAfterResponse(() => deleteSlackMessage(channelId, messageTs));

    return new Response(null, { status: 200 });
  }

  if (action.action_id === "issue_overflow" && selected.action === "delete") {
    const [ownerUserId, issueId] = selected.fields;

    if (!issueId || !isMessageOwner(ownerUserId, clickedByUserId)) {
      return rejectNonOwner("issue");
    }

    runAfterResponse(async () => {
      await Promise.all([
        deleteSlackMessage(channelId, messageTs),
        deleteIssueSubmission(channelId, issueId),
      ]);
    });

    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 200 });
}

export async function handleSlackInteraction(request: Request) {
  const rawBody = await request.text();

  if (!isValidSlackRequest(request, rawBody)) {
    return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  const payload = parseInteractionPayload(rawBody);

  if (!payload) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (payload.type === "block_actions") {
    return handleMessageAction(payload);
  }

  if (
    payload.type === "message_action" &&
    payload.callback_id === "add_blocking_issue"
  ) {
    return handleIssueShortcut(payload);
  }

  if (payload.type !== "view_submission") {
    return new Response(null, { status: 200 });
  }

  switch (payload.view?.callback_id) {
    case "daily_create":
      return handleDailySubmission(payload);
    case "issue_create":
      return handleIssueSubmission(payload);
    case "pr_create":
      return handlePrSubmission(payload);
    default:
      return new Response(null, { status: 200 });
  }
}
