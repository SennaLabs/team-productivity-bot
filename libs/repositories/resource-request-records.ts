import type {
  ResourceRequest,
  ResourceRequestStatus,
  ResourceRequestUrgency,
} from "@/models/resource-request";

const STATUSES: readonly ResourceRequestStatus[] = [
  "Pending",
  "Need Info",
  "Approved",
  "Rejected",
  "Cancelled",
];
const URGENCIES: readonly ResourceRequestUrgency[] = ["Low", "Normal", "Urgent"];

function toString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

// Tolerates missing or mistyped fields, e.g. a document edited by hand in the
// console, rather than failing the whole read.
export function toResourceRequest(
  documentId: string,
  data: Record<string, unknown>,
): ResourceRequest {
  const status = STATUSES.find((value) => value === data.status) ?? "Pending";
  const urgency = URGENCIES.find((value) => value === data.urgency) ?? "Normal";

  return {
    requestId: toString(data.requestId) || documentId,
    createdAt: toString(data.createdAt),
    requesterId: toString(data.requesterId),
    requesterName: toNullableString(data.requesterName),
    personId: toString(data.personId),
    ownerPmId: toString(data.ownerPmId),
    project: toString(data.project),
    mandays: typeof data.mandays === "number" ? data.mandays : 0,
    startDate: toString(data.startDate),
    endDate: toString(data.endDate),
    // Requests made before times existed have neither field.
    startTime: toNullableString(data.startTime),
    endTime: toNullableString(data.endTime),
    urgency,
    reason: toString(data.reason),
    status,
    decidedBy: toNullableString(data.decidedBy),
    decisionNote: toNullableString(data.decisionNote),
    decidedAt: toNullableString(data.decidedAt),
    channelId: toNullableString(data.channelId),
    messageTs: toNullableString(data.messageTs),
  };
}
