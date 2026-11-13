import type {
  BorrowedPerson,
  ResourceRequest,
  ResourceRequestStatus,
} from "@/models/resource-request";
import type { SlackBlock } from "@/models/slack-api";
import { decodeActionValue, encodeActionValue } from "../messages.ts";
import { CANCELLABLE_STATUSES, formatAmount, OPEN_STATUSES } from "./requests.ts";

// Every Slack ID this feature owns starts with this prefix, which is how
// libs/utils/interactions.ts knows to hand a payload over.
export const RESOURCE_REQUEST_PREFIX = "resource_request";

export const RESOURCE_REQUEST_IDS = {
  shortcut: "resource_request_shortcut",
  createModal: "resource_request_create",
  editModal: "resource_request_edit",
  approveModal: "resource_request_approve_submit",
  rejectModal: "resource_request_reject_submit",
  infoModal: "resource_request_info_submit",
  cancelModal: "resource_request_cancel_submit",
  approveButton: "resource_request_approve",
  rejectButton: "resource_request_reject",
  infoButton: "resource_request_info",
  // The requester's "⋯" menu on the card: edit or cancel.
  manageMenu: "resource_request_manage",
} as const;

const STATUS_LABELS: Record<ResourceRequestStatus, string> = {
  Pending: ":hourglass_flowing_sand: รออนุมัติ",
  "Need Info": ":speech_balloon: รอข้อมูลเพิ่ม",
  Approved: ":white_check_mark: อนุมัติแล้ว",
  Rejected: ":x: ไม่อนุมัติ",
  Cancelled: ":no_entry_sign: ยกเลิกแล้ว",
};

const URGENCY_LABELS: Record<string, string> = {
  Low: "Low",
  Normal: "Normal",
  Urgent: ":rotating_light: Urgent",
};

export function escapeMrkdwn(value: string | null | undefined) {
  return (value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function mention(userId: string | null) {
  return userId ? `<@${userId}>` : "-";
}

function mentionAll(userIds: readonly string[]) {
  return userIds.length ? userIds.map(mention).join(", ") : "-";
}

// Each borrowed person gets the full amount, so several people read "per person".
function amountOf(request: Pick<ResourceRequest, "mandays" | "personIds">) {
  return request.personIds.length > 1
    ? `${formatAmount(request.mandays)} ต่อคน`
    : formatAmount(request.mandays);
}

export function statusLabel(status: ResourceRequestStatus) {
  return STATUS_LABELS[status];
}

function formatTimeWindow(request: Pick<ResourceRequest, "startTime" | "endTime">) {
  return request.startTime && request.endTime ? `${request.startTime}–${request.endTime}` : null;
}

// A single date when the range is one day, then the daily window if there is one.
export function formatDateRange(
  request: Pick<ResourceRequest, "startDate" | "endDate" | "startTime" | "endTime">,
) {
  const singleDay = request.startDate === request.endDate;
  const dates = singleDay ? request.startDate : `${request.startDate} → ${request.endDate}`;
  const window = formatTimeWindow(request);

  if (!window) {
    return dates;
  }

  return singleDay ? `${dates} ${window}` : `${dates} เวลา ${window} ทุกวัน`;
}

// One line used in DMs, modals and the card's notification text.
export function summarizeRequest(request: ResourceRequest) {
  return `${request.requestId} · ยืม ${mentionAll(request.personIds)} ไป ${escapeMrkdwn(request.project)} · ${amountOf(request)} (${formatDateRange(request)})`;
}

export type ManageChoice = "edit" | "cancel";

export function decodeManageValue(value: string | undefined) {
  const selected = decodeActionValue(value);
  const requestId = selected?.fields[0];

  return (selected?.action === "edit" || selected?.action === "cancel") && requestId
    ? { choice: selected.action as ManageChoice, requestId }
    : null;
}

// The card posted to the requests channel. Decision buttons show while the PM
// can still act; the requester's menu shows until the request is closed.
export function createResourceRequestCard(request: ResourceRequest) {
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `ขอยืมคน ${request.requestId}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${mention(request.requesterId)} ขอยืม ${mentionAll(request.personIds)} จาก ${mention(request.ownerPmId)} ไปช่วย *${escapeMrkdwn(request.project)}*`,
      },
      fields: [
        { type: "mrkdwn", text: `*จำนวน*\n${amountOf(request)}` },
        { type: "mrkdwn", text: `*ช่วงวันที่*\n${formatDateRange(request)}` },
        {
          type: "mrkdwn",
          text: `*ความเร่งด่วน*\n${URGENCY_LABELS[request.urgency] ?? request.urgency}`,
        },
        { type: "mrkdwn", text: `*ผู้อนุมัติ*\n${mention(request.ownerPmId)}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*รายละเอียดงาน*\n${escapeMrkdwn(request.reason)}`,
      },
    },
    { type: "divider" },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*สถานะ:* ${statusLabel(request.status)}` },
      ],
    },
  ];

  if (request.decidedBy && request.status !== "Pending") {
    const decision = [`โดย ${mention(request.decidedBy)}`];

    if (request.decisionNote) {
      decision.push(`หมายเหตุ: ${escapeMrkdwn(request.decisionNote)}`);
    }

    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: decision.join("  ·  ") }],
    });
  }

  const elements: SlackBlock[] = [];

  if (OPEN_STATUSES.includes(request.status)) {
    elements.push(
      {
        type: "button",
        action_id: RESOURCE_REQUEST_IDS.approveButton,
        style: "primary",
        text: { type: "plain_text", text: "Approve" },
        value: request.requestId,
      },
      {
        type: "button",
        action_id: RESOURCE_REQUEST_IDS.rejectButton,
        style: "danger",
        text: { type: "plain_text", text: "Reject" },
        value: request.requestId,
      },
      {
        type: "button",
        action_id: RESOURCE_REQUEST_IDS.infoButton,
        text: { type: "plain_text", text: "Request info" },
        value: request.requestId,
      },
    );
  }

  // Everyone sees the menu; the handler checks who picked it.
  if (CANCELLABLE_STATUSES.includes(request.status)) {
    const options = OPEN_STATUSES.includes(request.status)
      ? [{ text: "แก้ไขคำขอ", choice: "edit" }]
      : [];

    options.push({ text: "ยกเลิกคำขอ", choice: "cancel" });
    elements.push({
      type: "overflow",
      action_id: RESOURCE_REQUEST_IDS.manageMenu,
      options: options.map((option) => ({
        text: { type: "plain_text", text: option.text },
        value: encodeActionValue(option.choice, request.requestId),
      })),
    });
  }

  if (elements.length) {
    blocks.push({ type: "actions", block_id: "actions", elements });
  }

  return { text: `คำขอยืมคน: ${summarizeRequest(request)}`, blocks };
}

// Slack allows 50 blocks per message; this leaves room for the header and footer.
const MAX_BORROWED_PEOPLE = 45;
// Keeps one person's section under Slack's 3000-character limit.
const MAX_LINES_PER_PERSON = 15;

// The /borrowed reply: who is lent out, where, and for how many mandays.
export function createBorrowedMessage(people: BorrowedPerson[], title: string) {
  const header = { type: "section", text: { type: "mrkdwn", text: `*${title}*` } };

  if (!people.length) {
    return {
      text: title,
      blocks: [
        header,
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "ไม่มีใครถูกยืมในช่วงนี้" }],
        },
      ],
    };
  }

  const blocks: SlackBlock[] = [header, { type: "divider" }];

  for (const person of people.slice(0, MAX_BORROWED_PEOPLE)) {
    const lines = person.requests
      .slice(0, MAX_LINES_PER_PERSON)
      .map(
        (request) =>
          `• ${escapeMrkdwn(request.project)} · ${formatAmount(request.mandays)} · ${formatDateRange(request)} · จาก ${mention(request.ownerPmId)} ให้ ${mention(request.requesterId)}`,
      );

    if (person.requests.length > MAX_LINES_PER_PERSON) {
      lines.push(`…และอีก ${person.requests.length - MAX_LINES_PER_PERSON} รายการ`);
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${mention(person.personId)} · รวม *${formatAmount(person.totalMandays)}*\n${lines.join("\n")}`,
      },
    });
  }

  const footer = ["นับจำนวนเต็มของแต่ละคำขอ แม้คำขอนั้นจะคาบเกี่ยวช่วงนี้แค่บางส่วน"];

  if (people.length > MAX_BORROWED_PEOPLE) {
    footer.unshift(`แสดง ${MAX_BORROWED_PEOPLE} จาก ${people.length} คน`);
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: footer.join(" · ") }],
  });

  return { text: title, blocks };
}

// What an edit changed, for the card's thread.
export function describeChanges(before: ResourceRequest, after: ResourceRequest) {
  const fields: [keyof ResourceRequest, string, (request: ResourceRequest) => string][] = [
    ["ownerPmId", "PM", (request) => mention(request.ownerPmId)],
    ["project", "โปรเจกต์", (request) => escapeMrkdwn(request.project)],
    ["mandays", "จำนวน", (request) => formatAmount(request.mandays)],
    ["startDate", "วันเริ่ม", (request) => request.startDate],
    ["endDate", "วันสิ้นสุด", (request) => request.endDate],
    ["urgency", "ความเร่งด่วน", (request) => request.urgency],
  ];
  const changes = fields
    .filter(([key]) => before[key] !== after[key])
    .map(([, label, show]) => `${label}: ${show(before)} → ${show(after)}`);

  if (before.personIds.join() !== after.personIds.join()) {
    changes.unshift(`คนที่ยืม: ${mentionAll(before.personIds)} → ${mentionAll(after.personIds)}`);
  }

  if (before.startTime !== after.startTime || before.endTime !== after.endTime) {
    changes.push(`เวลา: ${formatTimeWindow(before) ?? "ไม่ระบุ"} → ${formatTimeWindow(after) ?? "ไม่ระบุ"}`);
  }

  if (before.reason !== after.reason) {
    changes.push("แก้รายละเอียดงาน");
  }

  return changes;
}

function note(request: ResourceRequest) {
  return request.decisionNote ? `\nหมายเหตุ: ${escapeMrkdwn(request.decisionNote)}` : "";
}

// Plain-text notifications. Each is its own function so tests can pin the wording
// that people get pinged with.
export const notices = {
  submitted: (request: ResourceRequest, link: string) =>
    `:inbox_tray: ส่งคำขอ *${summarizeRequest(request)}* แล้ว รอ ${mention(request.ownerPmId)} อนุมัติ · ${link}`,
  askOwner: (request: ResourceRequest, link: string) =>
    `:raising_hand: ${mention(request.requesterId)} ขอยืมคนจากคุณ: *${summarizeRequest(request)}*\nกด Approve / Reject ได้ที่การ์ด · ${link}`,
  approvedToRequester: (request: ResourceRequest, actorId: string) =>
    `:white_check_mark: ${mention(actorId)} อนุมัติคำขอ *${summarizeRequest(request)}*${note(request)}`,
  approvedToPerson: (request: ResourceRequest, actorId: string) =>
    `:wave: ${mention(actorId)} อนุมัติให้ ${mention(request.requesterId)} ยืมตัวคุณไปช่วย *${escapeMrkdwn(request.project)}* ${formatAmount(request.mandays)} (${formatDateRange(request)})\nรายละเอียด: ${escapeMrkdwn(request.reason)}${note(request)}`,
  rejected: (request: ResourceRequest, actorId: string) =>
    `:x: คำขอ *${summarizeRequest(request)}* ไม่ได้รับอนุมัติโดย ${mention(actorId)}${note(request)}`,
  // Asked in the card's thread so the discussion stays next to the request; the
  // mention notifies the requester, so no DM is needed.
  needInfo: (request: ResourceRequest, actorId: string) =>
    `${mention(request.requesterId)} ${mention(actorId)} ขอข้อมูลเพิ่ม:\n>${escapeMrkdwn(request.decisionNote)}\nตอบใน thread นี้ หรือกด ⋯ → แก้ไขคำขอ บนการ์ด`,
  edited: (request: ResourceRequest, actorId: string, changes: string[]) =>
    `:pencil2: ${mention(actorId)} แก้ไขคำขอ${
      changes.length
        ? `\n${changes.map((change) => `• ${change}`).join("\n")}`
        : " (ข้อมูลเหมือนเดิม ส่งให้พิจารณาอีกครั้ง)"
    }\n${mention(request.ownerPmId)} ช่วยพิจารณาอีกครั้ง`,
  // Once approved, the borrowed person was told to help, so they hear it is off.
  cancelled: (request: ResourceRequest, previous: ResourceRequest, actorId: string) =>
    `:no_entry_sign: ${mention(actorId)} ยกเลิกคำขอ${
      request.decisionNote ? `\nเหตุผล: ${escapeMrkdwn(request.decisionNote)}` : ""
    }\n${
      previous.status === "Approved"
        ? `${mention(request.ownerPmId)} ${mentionAll(request.personIds)} ไม่ต้องไปช่วยงานนี้แล้ว`
        : mention(request.ownerPmId)
    }`,
  submitFailed: ":warning: ส่งคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือแจ้งแอดมิน",
  saveFailed: ":warning: บันทึกไม่สำเร็จ กรุณาลองใหม่",
};

// Why a decision, edit or cancel was refused, for a DM to whoever tried.
export function refusalNotice(
  result:
    | { reason: "not_found" | "note_required" }
    | {
        reason: "not_approver" | "already_decided" | "not_requester" | "not_editable";
        request: ResourceRequest;
      },
  action = "แก้ไข",
) {
  switch (result.reason) {
    case "not_found":
      return "ไม่พบคำขอนี้ (การ์ดอาจถูกลบไปแล้ว)";
    case "note_required":
      return "กรุณากรอกเหตุผล";
    case "not_approver":
      return `:lock: คำขอ ${result.request.requestId} ต้องให้ ${mention(result.request.ownerPmId)} เป็นคนอนุมัติ`;
    case "already_decided":
      return `คำขอ ${result.request.requestId} ${statusLabel(result.request.status)} โดย ${mention(result.request.decidedBy)} ไปก่อนแล้ว`;
    case "not_requester":
      return `:lock: เฉพาะ ${mention(result.request.requesterId)} ที่ขอ ที่${action}คำขอ ${result.request.requestId} ได้`;
    case "not_editable":
      return `คำขอ ${result.request.requestId} ${statusLabel(result.request.status)} แล้ว ${action}ไม่ได้`;
  }
}
