import { randomInt } from "node:crypto";
import type {
  BorrowedPerson,
  ChangeResult,
  DateRange,
  DecisionResult,
  ResourceRequest,
  ResourceRequestDecision,
  ResourceRequestInput,
  ResourceRequestMutation,
  ResourceRequestOverlaps,
  ResourceRequestStatus,
  ResourceRequestUrgency,
} from "@/models/resource-request";

export const URGENCIES = ["Low", "Normal", "Urgent"] as const satisfies readonly ResourceRequestUrgency[];

export const STATUSES = [
  "Pending",
  "Need Info",
  "Approved",
  "Rejected",
  "Cancelled",
] as const satisfies readonly ResourceRequestStatus[];

// The owner PM can still decide these.
export const OPEN_STATUSES: readonly ResourceRequestStatus[] = ["Pending", "Need Info"];

// The requester can still withdraw these, including an approval no longer needed.
export const CANCELLABLE_STATUSES: readonly ResourceRequestStatus[] = [
  "Pending",
  "Need Info",
  "Approved",
];

export const MAX_MANDAYS = 100;
export const MAX_PROJECT_LENGTH = 200;
export const MAX_REASON_LENGTH = 2000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Mon–Fri between two dates, inclusive. Public holidays are not known here.
export function workingDays(start: string, end: string) {
  const day = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  let count = 0;

  while (day <= last) {
    const weekday = day.getUTCDay();

    if (weekday !== 0 && weekday !== 6) {
      count++;
    }

    day.setUTCDate(day.getUTCDate() + 1);
  }

  return count;
}

// Raw form values, keyed by the modal's block_ids.
export type ResourceRequestForm = Partial<
  Record<
    | "person"
    | "owner_pm"
    | "project"
    | "mandays"
    | "start_date"
    | "end_date"
    | "urgency"
    | "reason",
    string
  >
>;

// Errors are keyed by block_id, so they go straight back to Slack as
// `response_action: "errors"`.
export function validateResourceRequestForm(
  form: ResourceRequestForm,
): { ok: true; input: ResourceRequestInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const project = form.project?.trim() ?? "";
  const reason = form.reason?.trim() ?? "";
  const rawMandays = form.mandays?.trim() ?? "";
  const mandays = Number(rawMandays);
  const startDate = form.start_date ?? "";
  const endDate = form.end_date ?? "";
  const urgency = URGENCIES.find((value) => value === form.urgency);

  if (!form.person) {
    errors.person = "กรุณาเลือกคนที่ต้องการยืม";
  }

  if (!form.owner_pm) {
    errors.owner_pm = "กรุณาเลือก PM ที่ดูแลคนนี้";
  }

  if (!project) {
    errors.project = "กรุณาระบุโปรเจกต์/งาน";
  } else if (project.length > MAX_PROJECT_LENGTH) {
    errors.project = `ยาวได้ไม่เกิน ${MAX_PROJECT_LENGTH} ตัวอักษร`;
  }

  if (!rawMandays || !Number.isFinite(mandays)) {
    errors.mandays = "กรุณาใส่จำนวน manday";
  } else if (mandays <= 0) {
    errors.mandays = "manday ต้องมากกว่า 0";
  } else if (mandays > MAX_MANDAYS) {
    errors.mandays = "manday มากเกินไป";
  } else if (!Number.isInteger(mandays * 2)) {
    errors.mandays = "ใส่ทีละครึ่งวัน เช่น 0.5, 1, 1.5";
  }

  if (!ISO_DATE.test(startDate)) {
    errors.start_date = "กรุณาเลือกวันเริ่ม";
  }

  if (!ISO_DATE.test(endDate)) {
    errors.end_date = "กรุณาเลือกวันสิ้นสุด";
  } else if (!errors.start_date && endDate < startDate) {
    errors.end_date = "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม";
  }

  if (!errors.mandays && !errors.start_date && !errors.end_date) {
    const days = workingDays(startDate, endDate);

    if (mandays > days) {
      errors.mandays = `ช่วงวันที่เลือกมีวันทำงาน ${days} วัน แต่ขอ ${mandays} manday`;
    }
  }

  if (!urgency) {
    errors.urgency = "กรุณาเลือกความเร่งด่วน";
  }

  if (!reason) {
    errors.reason = "กรุณาใส่รายละเอียดงาน";
  } else if (reason.length > MAX_REASON_LENGTH) {
    errors.reason = `ยาวได้ไม่เกิน ${MAX_REASON_LENGTH} ตัวอักษร`;
  }

  if (Object.keys(errors).length || !form.person || !form.owner_pm || !urgency) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    input: {
      personId: form.person,
      ownerPmId: form.owner_pm,
      project,
      mandays,
      startDate,
      endDate,
      urgency,
      reason,
    },
  };
}

// No 0/O/1/I, so an ID read aloud or retyped is not misread.
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

// A short random ID such as RR-7F3K9Q. A running number would need a counter
// document that every create contends on.
export function newResourceRequestId(random: (max: number) => number = randomInt) {
  let id = "";

  for (let index = 0; index < 6; index++) {
    id += ID_ALPHABET[random(ID_ALPHABET.length)];
  }

  return `RR-${id}`;
}

export function newResourceRequest(
  input: ResourceRequestInput,
  requestId: string,
  requester: { id: string; name: string | null },
  now: Date,
): ResourceRequest {
  return {
    ...input,
    requestId,
    createdAt: now.toISOString(),
    requesterId: requester.id,
    requesterName: requester.name,
    status: "Pending",
    decidedBy: null,
    decisionNote: null,
    decidedAt: null,
    channelId: null,
    messageTs: null,
  };
}

// The tagged owner PM decides; an admin can stand in when they are away.
export function canDecide(userId: string, request: ResourceRequest, adminIds: readonly string[]) {
  return userId === request.ownerPmId || adminIds.includes(userId);
}

// Only whoever asked (or an admin) may edit or withdraw a request.
export function canManage(userId: string, request: ResourceRequest, adminIds: readonly string[]) {
  return userId === request.requesterId || adminIds.includes(userId);
}

// These run inside a Firestore transaction, which may retry them, so they only
// compute: no I/O and no side effects.
export function decideResourceRequest(
  request: ResourceRequest | undefined,
  actorId: string,
  decision: ResourceRequestDecision,
  adminIds: readonly string[],
  now: Date,
): ResourceRequestMutation<DecisionResult> {
  const note = decision.note.trim();

  if (decision.type !== "approve" && !note) {
    return { result: { ok: false, reason: "note_required" } };
  }

  if (!request) {
    return { result: { ok: false, reason: "not_found" } };
  }

  if (!canDecide(actorId, request, adminIds)) {
    return { result: { ok: false, reason: "not_approver", request } };
  }

  if (!OPEN_STATUSES.includes(request.status)) {
    return { result: { ok: false, reason: "already_decided", request } };
  }

  const updated: ResourceRequest = {
    ...request,
    status:
      decision.type === "approve"
        ? "Approved"
        : decision.type === "reject"
          ? "Rejected"
          : "Need Info",
    decidedBy: actorId,
    decisionNote: note || null,
    decidedAt: now.toISOString(),
  };

  return { update: updated, result: { ok: true, request: updated } };
}

// Editing sends the request back to Pending so the PM looks again; it is also
// how a requester answers a Need Info.
export function editResourceRequest(
  request: ResourceRequest | undefined,
  actorId: string,
  input: ResourceRequestInput,
  adminIds: readonly string[],
): ResourceRequestMutation<ChangeResult> {
  if (!request) {
    return { result: { ok: false, reason: "not_found" } };
  }

  if (!canManage(actorId, request, adminIds)) {
    return { result: { ok: false, reason: "not_requester", request } };
  }

  if (!OPEN_STATUSES.includes(request.status)) {
    return { result: { ok: false, reason: "not_editable", request } };
  }

  const updated: ResourceRequest = {
    ...request,
    ...input,
    status: "Pending",
    decidedBy: null,
    decisionNote: null,
    decidedAt: null,
  };

  return {
    update: updated,
    result: { ok: true, request: updated, previous: request },
  };
}

export function cancelResourceRequest(
  request: ResourceRequest | undefined,
  actorId: string,
  note: string,
  adminIds: readonly string[],
  now: Date,
): ResourceRequestMutation<ChangeResult> {
  if (!request) {
    return { result: { ok: false, reason: "not_found" } };
  }

  if (!canManage(actorId, request, adminIds)) {
    return { result: { ok: false, reason: "not_requester", request } };
  }

  if (!CANCELLABLE_STATUSES.includes(request.status)) {
    return { result: { ok: false, reason: "not_editable", request } };
  }

  const updated: ResourceRequest = {
    ...request,
    status: "Cancelled",
    decidedBy: actorId,
    decisionNote: note.trim() || null,
    decidedAt: now.toISOString(),
  };

  return {
    update: updated,
    result: { ok: true, request: updated, previous: request },
  };
}

// YYYY-MM-DD compares correctly as a string, so ranges need no Date parsing.
export function rangesOverlap(a: DateRange, b: DateRange) {
  return a.start <= b.end && b.start <= a.end;
}

function rangeOf(request: ResourceRequest): DateRange {
  return { start: request.startDate, end: request.endDate };
}

function byStartDate(a: ResourceRequest, b: ResourceRequest) {
  return (
    a.startDate.localeCompare(b.startDate) ||
    a.requestId.localeCompare(b.requestId)
  );
}

// Other requests that borrow the same person over overlapping dates.
export function findOverlaps(
  request: ResourceRequest,
  others: readonly ResourceRequest[],
): ResourceRequestOverlaps {
  const same = others.filter(
    (other) =>
      other.requestId !== request.requestId &&
      other.personId === request.personId &&
      rangesOverlap(rangeOf(other), rangeOf(request)),
  );

  return {
    approved: same.filter((other) => other.status === "Approved").sort(byStartDate),
    pending: same.filter((other) => OPEN_STATUSES.includes(other.status)).sort(byStartDate),
  };
}

// Approved borrowings that touch the range, grouped by person, busiest first.
export function summarizeBorrowed(
  requests: readonly ResourceRequest[],
  range: DateRange,
): BorrowedPerson[] {
  const byPerson = new Map<string, ResourceRequest[]>();

  for (const request of requests) {
    if (request.status !== "Approved" || !rangesOverlap(rangeOf(request), range)) {
      continue;
    }

    byPerson.set(request.personId, [...(byPerson.get(request.personId) ?? []), request]);
  }

  return [...byPerson.entries()]
    .map(([personId, list]) => ({
      personId,
      totalMandays: list.reduce((sum, request) => sum + request.mandays, 0),
      requests: list.sort(byStartDate),
    }))
    .sort(
      (a, b) =>
        b.totalMandays - a.totalMandays || a.personId.localeCompare(b.personId),
    );
}

// The calendar month containing the date.
export function monthOf(date: string): DateRange {
  const [year, month] = date.split("-").map(Number);
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

function csv(value: string | undefined) {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

export function getResourceRequestSettings(env: Record<string, string | undefined> = process.env) {
  return {
    channelId: env.RESOURCE_REQUEST_CHANNEL_ID?.trim() || null,
    adminIds: csv(env.RESOURCE_REQUEST_ADMIN_IDS),
    // Empty means the form takes the project as free text.
    projects: csv(env.RESOURCE_REQUEST_PROJECTS),
  };
}
