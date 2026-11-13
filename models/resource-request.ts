export type ResourceRequestStatus =
  | "Pending"
  | "Need Info"
  | "Approved"
  | "Rejected"
  | "Cancelled";

export type ResourceRequestUrgency = "Low" | "Normal" | "Urgent";

// What the requester fills in: borrow people from the PM who looks after them.
export type ResourceRequestInput = {
  // At least one; every person gets the full amount below.
  personIds: string[];
  ownerPmId: string;
  project: string;
  // In 15-minute steps (1 manday = 8 hours), never more than the working time
  // between the dates.
  mandays: number;
  // YYYY-MM-DD, inclusive.
  startDate: string;
  endDate: string;
  // HH:MM, the same window on every day of the range; both null means any time.
  startTime: string | null;
  endTime: string | null;
  urgency: ResourceRequestUrgency;
  reason: string;
};

export type ResourceRequest = ResourceRequestInput & {
  requestId: string;
  createdAt: string;
  requesterId: string;
  requesterName: string | null;
  status: ResourceRequestStatus;
  // Who made the latest decision, or who cancelled it.
  decidedBy: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  // Where the card lives, so later changes can redraw it.
  channelId: string | null;
  messageTs: string | null;
};

export type ResourceRequestDecision = {
  type: "approve" | "reject" | "need_info";
  note: string;
};

// What a read-check-write decides: the record to save (if any) and what to return.
export type ResourceRequestMutation<T> = {
  update?: ResourceRequest;
  result: T;
};

export type DecisionResult =
  | { ok: true; request: ResourceRequest }
  | { ok: false; reason: "not_found" | "note_required" }
  | {
      ok: false;
      reason: "not_approver" | "already_decided";
      request: ResourceRequest;
    };

export type ChangeResult =
  | { ok: true; request: ResourceRequest; previous: ResourceRequest }
  | { ok: false; reason: "not_found" }
  | {
      ok: false;
      reason: "not_requester" | "not_editable";
      request: ResourceRequest;
    };

export type DateRange = {
  start: string;
  end: string;
};

export type ResourceRequestOverlaps = {
  // The same person already lent out over overlapping dates.
  approved: ResourceRequest[];
  // Other requests for the same person and dates still waiting for a decision.
  pending: ResourceRequest[];
};

export type BorrowedPerson = {
  personId: string;
  // Sum of the full mandays of each request, even one that only partly falls in the range.
  totalMandays: number;
  requests: ResourceRequest[];
};

export type ResourceRequestSettings = {
  channelId: string | null;
  adminIds: string[];
  projects: string[];
};
