import type {
  DailySubmission,
  IssueSubmission,
  PrPriority,
  PrSubmission,
  SlackBlock,
} from "@/models/slack-api";

// One table drives the modal's radio options and the posted message, so the level a
// reviewer picks is the level they see. Slack caps an option's `text` and its
// `description` at 75 chars each, which is why the Thai note sits on the label and
// the English SLA on the description rather than both in one string.
export const PR_PRIORITIES = [
  {
    value: "normal",
    emoji: ":coffee:",
    label: "Normal",
    note: "ไม่รีบ",
    sla: "Review by this evening",
  },
  {
    value: "attention",
    emoji: ":eyes:",
    label: "Attention",
    note: "ภายในเย็นวันนี้",
    sla: "Review within a few hours",
  },
  {
    value: "urgent",
    emoji: ":fire:",
    label: "Urgent",
    note: "ภายใน 1 ชม",
    sla: "Review as soon as possible",
  },
  {
    value: "critical",
    emoji: ":rotating_light:",
    label: "Critical",
    note: "ไวที่สุดเท่าที่จะเป็นได้",
    sla: "Review immediately — blocking release, hotfix, or production",
  },
] as const satisfies readonly {
  value: PrPriority;
  emoji: string;
  label: string;
  note: string;
  // Only the modal shows the English deadline; the message uses emoji + note.
  sla: string;
}[];

export const DEFAULT_PR_PRIORITY: PrPriority = "normal";

// Falls back rather than throwing: an unknown value means Slack sent something we
// do not model, and a review request is still worth posting at the safest level.
export function parsePrPriority(value: string | undefined): PrPriority {
  return (
    PR_PRIORITIES.find((priority) => priority.value === value)?.value ??
    DEFAULT_PR_PRIORITY
  );
}

export function getPrPriority(value: PrPriority) {
  return (
    PR_PRIORITIES.find((priority) => priority.value === value) ??
    PR_PRIORITIES[0]
  );
}

export const MAX_WATCHER_COUNT = 10;
export const MAX_WATCHER_NOTE_LENGTH = 300;

export const MAX_MERGE_NOTIFY_MINUTES = 60;

// Slack's number_input already enforces the 0–60 range client-side; this clamp is
// the server-side backstop for a submission that reaches us some other way.
export function parseMergeNotifyMinutes(value: string | undefined) {
  const minutes = Math.trunc(Number(value));

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 0;
  }

  return Math.min(minutes, MAX_MERGE_NOTIFY_MINUTES);
}

export function encodeActionValue(
  action: string,
  ...fields: (string | undefined)[]
) {
  return [action, ...fields.map((field) => field ?? "")].join(":");
}

export function decodeActionValue(value: string | undefined) {
  const [action, ...fields] = value?.split(":") ?? [];

  return action ? { action, fields } : null;
}

export function decodeWatcherUserIds(value: string | undefined) {
  return (
    value
      ?.split(",")
      .map((userId) => userId.trim())
      .filter(Boolean) ?? []
  );
}

// The note rides last and is rejoined because decodeActionValue splits on ":" and a
// typed note may contain one. Buttons posted before the note existed carry only the
// watchers, so the missing fields fall back to "post now, no note".
export function decodePrMergedAction(fields: string[]) {
  const [watchers, minutes, ...note] = fields;

  return {
    watcherUserIds: decodeWatcherUserIds(watchers),
    notifyAfterMinutes: parseMergeNotifyMinutes(minutes),
    watcherNote: note.join(":") || undefined,
  };
}

function escapeMrkdwn(value: string | undefined) {
  return (value ?? "-")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createDailyMessage(submission: DailySubmission) {
  const { startTime, endTime, userId, userName, note } = submission;
  const noteText = note ? `\n*Note:* ${escapeMrkdwn(note)}` : "";
  const summary = `*Daily Meeting:* ${startTime}–${endTime} · โดย  <@${userId}>${noteText}`;

  return {
    text: `Daily Meeting: ${startTime}–${endTime} โดย ${userName ?? userId}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: summary },
      },
    ] satisfies SlackBlock[],
  };
}

export function createIssueMessage(
  submission: IssueSubmission,
  issueId: string,
) {
  const {
    problem,
    blocking,
    askUserIds,
    askUserNames,
    need,
    minutes,
    note,
    userId,
  } = submission;
  const noteText = note ? `\n*Note:* ${escapeMrkdwn(note)}` : "";
  const askMentions =
    askUserIds.map((userId) => `<@${userId}>`).join(", ") || "-";
  const askNames = askUserNames?.join(", ") || askMentions;

  return {
    text: `ขอความช่วยเหลือ: ${problem ?? "-"} | Ask: ${askNames}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Owner issue:* <@${userId}>\n*Problem:* ${escapeMrkdwn(problem)}\n*Blocking:* ${escapeMrkdwn(blocking)}\n*Ask:* ${askMentions}\n*Need:* ${escapeMrkdwn(need)}\n*Time:* ${minutes ?? "-"} นาที${noteText}\n`,
        },
      },
      {
        type: "actions",
        block_id: "issue_actions",
        elements: [
          {
            type: "overflow",
            action_id: "issue_overflow",
            options: [
              {
                text: { type: "plain_text", text: "Delete" },
                value: encodeActionValue("delete", userId, issueId),
              },
            ],
            confirm: {
              title: { type: "plain_text", text: "ลบ issue นี้" },
              text: {
                type: "plain_text",
                text: "ข้อความนี้และข้อมูลใน dashboard จะถูกลบ กู้คืนไม่ได้",
              },
              confirm: { type: "plain_text", text: "ลบ" },
              deny: { type: "plain_text", text: "ยกเลิก" },
              style: "danger",
            },
          },
        ],
      },
    ] satisfies SlackBlock[],
  };
}

const MARKDOWN_LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;

function formatTicketLink(raw: string) {
  const match = MARKDOWN_LINK.exec(raw.trim());

  if (!match) {
    return escapeMrkdwn(raw);
  }

  const [, label, url] = match;

  try {
    const href = new URL(url).toString();

    return `<${escapeMrkdwn(href)}|${escapeMrkdwn(label)}>`;
  } catch {
    return escapeMrkdwn(raw);
  }
}

function formatTicketLinks(links: string[]) {
  if (!links.length) {
    return "-";
  }

  if (links.length === 1) {
    return formatTicketLink(links[0]);
  }

  return `\n${links.map((link) => `• ${formatTicketLink(link)}`).join("\n")}`;
}

export function createPrMessage(submission: PrSubmission) {
  const {
    ticketLinks,
    prUrl,
    priority,
    reviewerUserIds,
    watcherUserIds,
    mergeNotifyMinutes,
    watcherNote,
    userId,
  } = submission;
  const level = getPrPriority(priority);
  const reviewers =
    reviewerUserIds.map((reviewerId) => `<@${reviewerId}>`).join(", ") || "-";

  return {
    text: `[${level.label}] ขอรีวิว PR: ${prUrl} | Reviewer: ${reviewers}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          // The level folds into lines that already exist — a coloured dot leading
          // the first line, the label closing the reviewer line — so a request stays
          // four lines whatever its urgency. prUrl is posted bare so Slack autolinks
          // and unfurls it; everything the user typed goes through escapeMrkdwn.
          text: `${level.emoji} *Owner PR:* <@${userId}>\n*Ticket:* ${formatTicketLinks(ticketLinks)}\n*PR:* ${escapeMrkdwn(prUrl)}\n*Reviewer:* ${reviewers} · *${level.label}* — ${level.note}\n`,
        },
      },
      {
        type: "actions",
        block_id: "pr_actions",
        elements: [
          {
            type: "button",
            action_id: "pr_merged",
            style: "primary",
            text: { type: "plain_text", text: "Merged" },
            // Watchers are deliberately absent from the text above and travel here
            // instead, so nobody is pinged until this is pressed.
            value: encodeActionValue(
              "merged",
              watcherUserIds.join(","),
              String(mergeNotifyMinutes),
              watcherNote,
            ),
          },
          {
            type: "overflow",
            action_id: "pr_overflow",
            options: [
              {
                text: { type: "plain_text", text: "Delete" },
                value: encodeActionValue("delete", userId),
              },
            ],
            // Delete is the only option here, so this dialog speaks for it alone.
            confirm: {
              title: { type: "plain_text", text: "ลบข้อความนี้" },
              text: {
                type: "plain_text",
                text: "ข้อความนี้และ reply ทั้ง thread จะถูกลบ กู้คืนไม่ได้",
              },
              confirm: { type: "plain_text", text: "ลบ" },
              deny: { type: "plain_text", text: "ยกเลิก" },
              style: "danger",
            },
          },
        ],
      },
    ] satisfies SlackBlock[],
  };
}

export function createPrScheduledNotice(
  submission: PrSubmission,
  postAt: number,
  scheduledMessageId: string,
) {
  const channelId = submission.channel.channelId ?? "";
  // Slack renders this token in each viewer's own timezone; the text after | is
  // only shown by clients that cannot.
  const when = `<!date^${postAt}^{date_short_pretty} {time}|${new Date(postAt * 1000).toISOString()}>`;

  return {
    text: `ตั้งเวลาส่งคำขอรีวิว PR ไว้ ${when}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:alarm_clock: ตั้งเวลาส่งคำขอรีวิว PR ไปที่ <#${channelId}> ${when}\n*PR:* ${escapeMrkdwn(submission.prUrl)}`,
        },
      },
      {
        type: "actions",
        block_id: "pr_schedule_actions",
        elements: [
          {
            type: "button",
            action_id: "pr_schedule_cancel",
            style: "danger",
            text: { type: "plain_text", text: "Cancel" },
            value: encodeActionValue("cancel", channelId, scheduledMessageId),
            confirm: {
              title: { type: "plain_text", text: "ยกเลิกการตั้งเวลา" },
              text: {
                type: "plain_text",
                text: "คำขอรีวิว PR นี้จะไม่ถูกโพสต์",
              },
              confirm: { type: "plain_text", text: "ยกเลิกการส่ง" },
              deny: { type: "plain_text", text: "ไม่ยกเลิก" },
              style: "danger",
            },
          },
        ],
      },
    ] satisfies SlackBlock[],
  };
}

export function createPrScheduleClosedUpdate(
  message: { blocks?: SlackBlock[] },
  status: string,
) {
  return {
    text: status,
    blocks: [
      ...(message.blocks ?? []).filter(
        (block) => (block as PrActionsBlock).block_id !== "pr_schedule_actions",
      ),
      { type: "context", elements: [{ type: "mrkdwn", text: status }] },
    ] satisfies SlackBlock[],
  };
}

export function createPrMergedMessage(
  watcherUserIds: string[],
  watcherNote?: string,
) {
  const watchers = watcherUserIds
    .map((watcherId) => `<@${watcherId}>`)
    .join(", ");
  const note = watcherNote ? escapeMrkdwn(watcherNote) : "";

  return {
    text: ["Merged", watchers && `แจ้ง ${watchers}`, note]
      .filter(Boolean)
      .join(" · "),
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [`*Already merged* ${watchers}`.trim(), note]
            .filter(Boolean)
            .join("\n"),
        },
      },
    ] satisfies SlackBlock[],
  };
}

type PrActionElement = {
  type?: string;
  action_id?: string;
};

type PrActionsBlock = {
  block_id?: string;
  elements?: PrActionElement[];
};

export function isMessageOwner(
  ownerUserId: string | undefined,
  clickedByUserId: string | undefined,
) {
  return Boolean(ownerUserId) && ownerUserId === clickedByUserId;
}

export function createPrMergedUpdate(
  message: { text?: string; blocks?: SlackBlock[] },
  mergedByUserId: string | undefined,
) {
  const originalBlocks = message.blocks ?? [];
  const isActions = (block: SlackBlock) =>
    (block as PrActionsBlock).block_id === "pr_actions";

  const remainingElements = (
    (originalBlocks.find(isActions) as PrActionsBlock | undefined)?.elements ??
    []
  ).filter((element) => element.action_id !== "pr_merged");
  const mergedBy = mergedByUserId ? ` โดย <@${mergedByUserId}>` : "";

  const blocks: SlackBlock[] = [
    ...originalBlocks.filter((block) => !isActions(block)),
    {
      type: "context",
      block_id: "pr_merged_marker",
      elements: [
        { type: "mrkdwn", text: `:white_check_mark: *Merged*${mergedBy}` },
      ],
    },
  ];
  if (remainingElements.length) {
    blocks.push({
      type: "actions",
      block_id: "pr_actions",
      elements: remainingElements,
    });
  }

  return {
    text: message.text ? `${message.text} · Merged` : "Merged",
    blocks,
  };
}
