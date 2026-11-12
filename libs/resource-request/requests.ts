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
// Requests are stored in mandays, but asked for in 15-minute steps. 15 minutes is
// 1/32 of a manday, which a float holds exactly, so sums never drift.
export const MINUTES_PER_MANDAY = 8 * 60;
const MINUTE_STEP = 15;

export const AMOUNT_UNITS = ["minutes", "hours", "mandays"] as const;
export type AmountUnit = (typeof AMOUNT_UNITS)[number];

const UNIT_MINUTES: Record<AmountUnit, number> = {
  minutes: 1,
  hours: 60,
  mandays: MINUTES_PER_MANDAY,
};

export const UNIT_LABELS: Record<AmountUnit, string> = {
  minutes: "นาที",
  hours: "ชั่วโมง",
  mandays: "manday",
};

// Whole and half days read as mandays; anything finer reads as hours and minutes.
export function formatAmount(mandays: number) {
  const minutes = Math.round(mandays * MINUTES_PER_MANDAY);

  if (minutes % (MINUTES_PER_MANDAY / 2) === 0) {
    return `${minutes / MINUTES_PER_MANDAY} manday`;
  }

  return formatDuration(minutes);
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return [hours ? `${hours} ชม.` : "", rest ? `${rest} นาที` : ""].filter(Boolean).join(" ");
}

// How the edit form shows a stored amount: the largest unit that keeps it short.
export function toAmountInput(mandays: number): { amount: string; unit: AmountUnit } {
  const minutes = Math.round(mandays * MINUTES_PER_MANDAY);

  if (minutes % (MINUTES_PER_MANDAY / 2) === 0) {
    return { amount: String(minutes / MINUTES_PER_MANDAY), unit: "mandays" };
  }

  return minutes < 60
    ? { amount: String(minutes), unit: "minutes" }
    : { amount: String(minutes / 60), unit: "hours" };
}
export const MAX_PROJECT_LENGTH = 200;
export const MAX_REASON_LENGTH = 2000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function minutesOfDay(time: string) {
  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
}

// A window longer than a manday, e.g. 09:00–18:00 with lunch, still counts as one manday a day.
function minutesPerDay(startTime: string | null, endTime: string | null) {
  return startTime && endTime
    ? Math.min(minutesOfDay(endTime) - minutesOfDay(startTime), MINUTES_PER_MANDAY)
    : MINUTES_PER_MANDAY;
}

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
    | "amount"
    | "unit"
    | "start_date"
    | "end_date"
    | "start_time"
    | "end_time"
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
  const rawAmount = form.amount?.trim() ?? "";
  const amount = Number(rawAmount);
  const unit = AMOUNT_UNITS.find((value) => value === form.unit);
  let minutes = 0;
  const startDate = form.start_date ?? "";
  const endDate = form.end_date ?? "";
  const startTime = form.start_time || null;
  const endTime = form.end_time || null;
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

  if (!unit) {
    errors.unit = "กรุณาเลือกหน่วย";
  }

  if (!rawAmount || !Number.isFinite(amount)) {
    errors.amount = "กรุณาใส่จำนวน";
  } else if (amount <= 0) {
    errors.amount = "จำนวนต้องมากกว่า 0";
  } else if (unit) {
    const exact = amount * UNIT_MINUTES[unit];
    minutes = Math.round(exact);

    // The tolerance absorbs float noise such as 1.1 * 60.
    if (Math.abs(exact - minutes) > 1e-6 || minutes % MINUTE_STEP !== 0) {
      errors.amount = "ใส่ทีละ 15 นาที เช่น 15 นาที, 1.5 ชั่วโมง, 0.5 manday";
    } else if (minutes > MAX_MANDAYS * MINUTES_PER_MANDAY) {
      errors.amount = `ขอได้ไม่เกิน ${MAX_MANDAYS} manday`;
    }
  }

  if (!ISO_DATE.test(startDate)) {
    errors.start_date = "กรุณาเลือกวันเริ่ม";
  }

  if (!ISO_DATE.test(endDate)) {
    errors.end_date = "กรุณาเลือกวันสิ้นสุด";
  } else if (!errors.start_date && endDate < startDate) {
    errors.end_date = "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม";
  }

  if (startTime && !TIME.test(startTime)) {
    errors.start_time = "เวลาไม่ถูกต้อง";
  } else if (endTime && !TIME.test(endTime)) {
    errors.end_time = "เวลาไม่ถูกต้อง";
  } else if (startTime && !endTime) {
    errors.end_time = "ใส่เวลาสิ้นสุดด้วย หรือลบเวลาเริ่มออก";
  } else if (endTime && !startTime) {
    errors.start_time = "ใส่เวลาเริ่มด้วย หรือลบเวลาสิ้นสุดออก";
  } else if (startTime && endTime && endTime <= startTime) {
    errors.end_time = "เวลาสิ้นสุดต้องหลังเวลาเริ่ม";
  }

  const mandays = minutes / MINUTES_PER_MANDAY;
  const hasTimeError = Boolean(errors.start_time || errors.end_time);

  if (minutes && !errors.amount && !errors.start_date && !errors.end_date && !hasTimeError) {
    const days = workingDays(startDate, endDate);
    const available = days * minutesPerDay(startTime, endTime);

    if (minutes > available) {
      errors.amount = startTime
        ? `ช่วงที่เลือกมีวันทำงาน ${days} วัน วันละ ${startTime}–${endTime} รวม ${formatDuration(available)} แต่ขอ ${formatDuration(minutes)}`
        : `ช่วงวันที่เลือกมีวันทำงาน ${days} วัน แต่ขอ ${formatAmount(mandays)}`;
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
      startTime,
      endTime,
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

// Without a window a request may take any time of its days, so it meets every window.
export function timesOverlap(
  a: Pick<ResourceRequest, "startTime" | "endTime">,
  b: Pick<ResourceRequest, "startTime" | "endTime">,
) {
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) {
    return true;
  }

  return a.startTime < b.endTime && b.startTime < a.endTime;
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

// Other requests that borrow the same person over overlapping dates and times.
export function findOverlaps(
  request: ResourceRequest,
  others: readonly ResourceRequest[],
): ResourceRequestOverlaps {
  const same = others.filter(
    (other) =>
      other.requestId !== request.requestId &&
      other.personId === request.personId &&
      rangesOverlap(rangeOf(other), rangeOf(request)) &&
      timesOverlap(other, request),
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
