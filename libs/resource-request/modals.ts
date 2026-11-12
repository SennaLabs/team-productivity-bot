import type {
  ResourceRequest,
  ResourceRequestOverlaps,
} from "@/models/resource-request";
import type {
  SlackBlock,
  SlackInteractionPayload,
  SlackModal,
} from "@/models/slack-api";
import {
  escapeMrkdwn,
  formatDateRange,
  RESOURCE_REQUEST_IDS,
  summarizeRequest,
} from "./messages.ts";
import {
  AMOUNT_UNITS,
  formatAmount,
  MAX_PROJECT_LENGTH,
  MAX_REASON_LENGTH,
  toAmountInput,
  UNIT_LABELS,
  URGENCIES,
  type ResourceRequestForm,
} from "./requests.ts";

// Every input uses this action_id; the block_id names the field.
const INPUT = "value";
const MAX_NOTE_LENGTH = 1000;

function plain(text: string) {
  return { type: "plain_text", text, emoji: true };
}

function staticSelect(
  blockId: string,
  label: string,
  values: readonly string[],
  initial?: string,
  labelOf: (value: string) => string = (value) => value,
) {
  const options = values.map((value) => ({ text: plain(labelOf(value)), value }));
  const initialOption = options.find((option) => option.value === initial);

  return {
    type: "input",
    block_id: blockId,
    label: plain(label),
    element: {
      type: "static_select",
      action_id: INPUT,
      placeholder: plain("เลือก"),
      options,
      ...(initialOption ? { initial_option: initialOption } : {}),
    },
  };
}

function userSelect(blockId: string, label: string, hint: string, initial?: string) {
  return {
    type: "input",
    block_id: blockId,
    label: plain(label),
    hint: plain(hint),
    element: {
      type: "users_select",
      action_id: INPUT,
      placeholder: plain("เลือกคน"),
      ...(initial ? { initial_user: initial } : {}),
    },
  };
}

function datePicker(blockId: string, label: string, initial?: string) {
  return {
    type: "input",
    block_id: blockId,
    label: plain(label),
    element: {
      type: "datepicker",
      action_id: INPUT,
      ...(initial ? { initial_date: initial } : {}),
    },
  };
}

function projectInput(projects: readonly string[], initial?: string) {
  if (!projects.length) {
    return {
      type: "input",
      block_id: "project",
      label: plain("ยืมไปช่วยโปรเจกต์/งาน"),
      element: {
        type: "plain_text_input",
        action_id: INPUT,
        max_length: MAX_PROJECT_LENGTH,
        ...(initial ? { initial_value: initial } : {}),
      },
    };
  }

  // A project removed from the list since stays selectable, so an edit keeps it.
  const options = initial && !projects.includes(initial) ? [initial, ...projects] : projects;

  return staticSelect("project", "ยืมไปช่วยโปรเจกต์/งาน", options, initial);
}

// The form to borrow a person. Pass `existing` for the edit form, prefilled and
// tied to that request through private_metadata.
export function createResourceRequestModal(
  projects: readonly string[],
  existing?: ResourceRequest,
): SlackModal {
  const initialAmount = existing ? toAmountInput(existing.mandays) : undefined;

  return {
    type: "modal",
    callback_id: existing ? RESOURCE_REQUEST_IDS.editModal : RESOURCE_REQUEST_IDS.createModal,
    ...(existing ? { private_metadata: existing.requestId } : {}),
    title: plain(existing ? `แก้ไข ${existing.requestId}` : "ขอยืมคน"),
    submit: plain(existing ? "บันทึก" : "ส่งคำขอ"),
    close: plain("ยกเลิก"),
    blocks: [
      userSelect("person", "คนที่ต้องการยืม", "Dev / QA / Designer ที่อยากได้", existing?.personId),
      userSelect("owner_pm", "ขอจาก PM", "PM ที่ดูแลคนนี้อยู่ เป็นคนอนุมัติ", existing?.ownerPmId),
      projectInput(projects, existing?.project),
      {
        type: "input",
        block_id: "amount",
        label: plain("จำนวน"),
        hint: plain("ทีละ 15 นาที เช่น 30 นาที, 1.5 ชั่วโมง, 2 manday (1 manday = 8 ชั่วโมง)"),
        element: {
          type: "number_input",
          action_id: INPUT,
          is_decimal_allowed: true,
          ...(initialAmount ? { initial_value: initialAmount.amount } : {}),
        },
      },
      staticSelect(
        "unit",
        "หน่วย",
        AMOUNT_UNITS,
        initialAmount?.unit ?? "mandays",
        (unit) => UNIT_LABELS[unit as keyof typeof UNIT_LABELS],
      ),
      datePicker("start_date", "ช่วงวันที่ เริ่ม", existing?.startDate),
      datePicker("end_date", "ช่วงวันที่ สิ้นสุด", existing?.endDate),
      staticSelect("urgency", "ความเร่งด่วน", URGENCIES, existing?.urgency ?? "Normal"),
      {
        type: "input",
        block_id: "reason",
        label: plain("รายละเอียดงาน"),
        element: {
          type: "plain_text_input",
          action_id: INPUT,
          multiline: true,
          max_length: MAX_REASON_LENGTH,
          placeholder: plain("เช่น ช่วยแก้ bug ก่อน demo ลูกค้า"),
          ...(existing ? { initial_value: existing.reason } : {}),
        },
      },
    ],
  };
}

function readInput(payload: SlackInteractionPayload, blockId: string) {
  const input = payload.view?.state?.values?.[blockId]?.[INPUT];

  return (
    input?.selected_option?.value ??
    input?.selected_date ??
    input?.selected_user ??
    input?.value ??
    undefined
  );
}

export function readResourceRequestForm(payload: SlackInteractionPayload): ResourceRequestForm {
  return {
    person: readInput(payload, "person"),
    owner_pm: readInput(payload, "owner_pm"),
    project: readInput(payload, "project"),
    amount: readInput(payload, "amount"),
    unit: readInput(payload, "unit"),
    start_date: readInput(payload, "start_date"),
    end_date: readInput(payload, "end_date"),
    urgency: readInput(payload, "urgency"),
    reason: readInput(payload, "reason"),
  };
}

export function readNote(payload: SlackInteractionPayload) {
  return readInput(payload, "note")?.trim() ?? "";
}

function noteInput(label: string, optional: boolean, placeholder: string) {
  return {
    type: "input",
    block_id: "note",
    optional,
    label: plain(label),
    element: {
      type: "plain_text_input",
      action_id: INPUT,
      multiline: true,
      max_length: MAX_NOTE_LENGTH,
      placeholder: plain(placeholder),
    },
  };
}

// private_metadata carries the request the submission is about.
function decisionModal(
  callbackId: string,
  title: string,
  submit: string,
  request: ResourceRequest,
  blocks: SlackBlock[],
): SlackModal {
  return {
    type: "modal",
    callback_id: callbackId,
    private_metadata: request.requestId,
    title: plain(title),
    submit: plain(submit),
    close: plain("ยกเลิก"),
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: summarizeRequest(request) } },
      ...blocks,
    ],
  };
}

function overlapLine(request: ResourceRequest) {
  return `• ${escapeMrkdwn(request.project)} · ${formatAmount(request.mandays)} · ${formatDateRange(request)} · ขอโดย <@${request.requesterId}> · ${request.requestId}`;
}

// Warns the PM when the same person is already lent out, or asked for, over the same dates.
export function createOverlapBlocks(
  request: ResourceRequest,
  overlaps: ResourceRequestOverlaps,
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  if (overlaps.approved.length) {
    const total = overlaps.approved.reduce((sum, other) => sum + other.mandays, 0);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *<@${request.personId}> ถูกยืมไปแล้ว ${formatAmount(total)} ในช่วงที่ทับกัน*\n${overlaps.approved.map(overlapLine).join("\n")}`,
      },
    });
  }

  if (overlaps.pending.length) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: มีคำขออื่นที่ยืม <@${request.personId}> ช่วงเดียวกันและยังรออนุมัติ\n${overlaps.pending.map(overlapLine).join("\n")}`,
        },
      ],
    });
  }

  return blocks.length ? [{ type: "divider" }, ...blocks] : [];
}

export function createApproveModal(request: ResourceRequest, overlaps?: ResourceRequestOverlaps) {
  return decisionModal(RESOURCE_REQUEST_IDS.approveModal, "อนุมัติคำขอ", "Approve", request, [
    ...(overlaps ? createOverlapBlocks(request, overlaps) : []),
    noteInput("หมายเหตุ", true, "เช่น ให้ได้เฉพาะช่วงบ่าย, ขอคืนก่อนวันศุกร์"),
  ]);
}

export function createRejectModal(request: ResourceRequest) {
  return decisionModal(RESOURCE_REQUEST_IDS.rejectModal, "ไม่อนุมัติคำขอ", "Reject", request, [
    noteInput("เหตุผล", false, "บอก PM ว่าทำไมไม่อนุมัติ"),
  ]);
}

export function createRequestInfoModal(request: ResourceRequest) {
  return decisionModal(RESOURCE_REQUEST_IDS.infoModal, "ขอข้อมูลเพิ่ม", "ส่งคำถาม", request, [
    noteInput("อยากรู้อะไรเพิ่ม", false, "คำถามจะถูกโพสต์ใน thread ของคำขอ"),
  ]);
}

export function createCancelModal(request: ResourceRequest) {
  const warning =
    request.status === "Approved"
      ? "คำขอนี้อนุมัติไปแล้ว ยกเลิกแล้วจะแจ้ง PM และคนที่ถูกยืมว่าไม่ต้องไปช่วยแล้ว"
      : "PM จะได้รับแจ้งว่าคำขอนี้ถูกยกเลิก";

  return {
    ...decisionModal(RESOURCE_REQUEST_IDS.cancelModal, "ยกเลิกคำขอ", "ยืนยันยกเลิก", request, [
      { type: "context", elements: [{ type: "mrkdwn", text: warning }] },
      noteInput("เหตุผล (ไม่บังคับ)", true, "เช่น ลูกค้าเลื่อน demo"),
    ]),
    // "ยกเลิก" would read as the cancel action itself here.
    close: plain("ปิด"),
  };
}

// A modal that only shows a message: loading, refusals and errors.
export function createMessageModal(title: string, message: string): SlackModal {
  return {
    type: "modal",
    title: plain(title),
    close: plain("ปิด"),
    blocks: [{ type: "section", text: { type: "mrkdwn", text: message } }],
  };
}
