import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cancelResourceRequest,
  formatAmount,
  decideResourceRequest,
  editResourceRequest,
  findOverlaps,
  getResourceRequestSettings,
  monthOf,
  newResourceRequest,
  newResourceRequestId,
  rangesOverlap,
  summarizeBorrowed,
  toAmountInput,
  validateResourceRequestForm,
  workingDays,
  type ResourceRequestForm,
} from "./requests.ts";
import type {
  ResourceRequest,
  ResourceRequestInput,
} from "@/models/resource-request";

const RIN = "U_RIN"; // the PM who looks after Earth
const EARTH = "U_EARTH";
const SALES = "U_SALES";
const ADMIN = "U_ADMIN";
const ADMINS = [ADMIN];
const NOW = new Date("2026-11-11T03:00:00Z");

const FORM: ResourceRequestForm = {
  person: EARTH,
  owner_pm: RIN,
  project: "Acme App",
  amount: "2",
  unit: "mandays",
  start_date: "2026-12-01", // Tue
  end_date: "2026-12-04", // Fri
  urgency: "Urgent",
  reason: "Demo",
};

function input(overrides: Partial<ResourceRequestInput> = {}): ResourceRequestInput {
  const result = validateResourceRequestForm(FORM);
  assert.ok(result.ok);

  return { ...result.input, ...overrides };
}

let nextId = 0;

function request(
  overrides: Partial<ResourceRequest> = {},
): ResourceRequest {
  return {
    ...newResourceRequest(input(), `RR-${String(nextId++).padStart(6, "0")}`, { id: SALES, name: "Sales" }, NOW),
    ...overrides,
  };
}

test("accepts a complete form and trims text", () => {
  const result = validateResourceRequestForm({ ...FORM, project: "  Acme  ", amount: "1.5" });

  assert.deepEqual(result, {
    ok: true,
    input: {
      personId: EARTH,
      ownerPmId: RIN,
      project: "Acme",
      mandays: 1.5,
      startDate: "2026-12-01",
      endDate: "2026-12-04",
      urgency: "Urgent",
      reason: "Demo",
    },
  });
});

test("reports every missing field by block_id", () => {
  const result = validateResourceRequestForm({});

  assert.equal(result.ok, false);
  assert.deepEqual(
    Object.keys(result.ok ? {} : result.errors).sort(),
    ["amount", "end_date", "owner_pm", "person", "project", "reason", "start_date", "unit", "urgency"],
  );
});

test("takes amounts in 15-minute steps in any unit", () => {
  for (const [amount, unit, mandays] of [
    ["15", "minutes", 1 / 32],
    ["30", "minutes", 1 / 16],
    ["1.25", "hours", 1.25 / 8],
    ["1.5", "hours", 1.5 / 8],
    ["0.5", "mandays", 0.5],
    ["100", "mandays", 100],
    ["10", "minutes", null],
    ["1.1", "hours", null],
    ["0.3", "mandays", null],
    ["0", "minutes", null],
    ["abc", "hours", null],
    ["101", "mandays", null],
    ["1", "weeks", null],
  ] as const) {
    const result = validateResourceRequestForm({ ...FORM, amount, unit, end_date: "2027-06-30" });
    assert.equal(result.ok ? result.input.mandays : null, mandays, `${amount} ${unit}`);
  }
});

test("shows an amount in the unit that reads naturally", () => {
  assert.deepEqual(
    [1 / 32, 1 / 16, 1.5 / 8, 8.5 / 8, 0.5, 2, 0].map(formatAmount),
    ["15 นาที", "30 นาที", "1 ชม. 30 นาที", "8 ชม. 30 นาที", "0.5 manday", "2 manday", "0 manday"],
  );
  assert.deepEqual(
    [1 / 16, 1.25 / 8, 1.5].map(toAmountInput),
    [{ amount: "30", unit: "minutes" }, { amount: "1.25", unit: "hours" }, { amount: "1.5", unit: "mandays" }],
  );
});

test("refuses an end date before the start date", () => {
  const result = validateResourceRequestForm({ ...FORM, end_date: "2026-11-30" });

  assert.deepEqual(result.ok ? null : result.errors, { end_date: "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม" });
});

test("refuses more mandays than working days in the range", () => {
  // Fri 4 Dec to Mon 7 Dec is two working days.
  const result = validateResourceRequestForm({ ...FORM, amount: "3", start_date: "2026-12-04", end_date: "2026-12-07" });

  assert.deepEqual(result.ok ? null : result.errors, {
    amount: "ช่วงวันที่เลือกมีวันทำงาน 2 วัน แต่ขอ 3 manday",
  });
  assert.equal(workingDays("2026-12-05", "2026-12-06"), 0);
});

test("draws IDs without characters that are easy to misread", () => {
  assert.equal(newResourceRequestId(() => 0), "RR-222222");
  assert.match(newResourceRequestId(), /^RR-[2-9A-HJ-NP-Z]{6}$/);
});

test("lets the tagged PM approve, recording who and when", () => {
  const { update, result } = decideResourceRequest(request(), RIN, { type: "approve", note: " afternoons only " }, ADMINS, NOW);

  assert.equal(result.ok, true);
  assert.deepEqual(
    { status: update?.status, decidedBy: update?.decidedBy, decisionNote: update?.decisionNote, decidedAt: update?.decidedAt },
    { status: "Approved", decidedBy: RIN, decisionNote: "afternoons only", decidedAt: NOW.toISOString() },
  );
});

test("refuses other PMs, the requester and the person, without saving", () => {
  for (const actor of ["U_OTHER_PM", SALES, EARTH]) {
    const mutation = decideResourceRequest(request(), actor, { type: "approve", note: "" }, ADMINS, NOW);

    assert.equal(mutation.update, undefined);
    assert.equal(mutation.result.ok ? "" : mutation.result.reason, "not_approver");
  }
});

test("lets an admin decide when the PM is away", () => {
  const { result } = decideResourceRequest(request(), ADMIN, { type: "reject", note: "Earth is on leave" }, ADMINS, NOW);

  assert.equal(result.ok && result.request.status, "Rejected");
});

test("needs a note to reject or ask for info, and refuses a decided request", () => {
  assert.deepEqual(decideResourceRequest(request(), RIN, { type: "reject", note: "  " }, ADMINS, NOW).result, {
    ok: false,
    reason: "note_required",
  });

  const decided = request({ status: "Approved", decidedBy: RIN });
  const { result } = decideResourceRequest(decided, RIN, { type: "reject", note: "changed my mind" }, ADMINS, NOW);
  assert.equal(result.ok ? "" : result.reason, "already_decided");

  assert.deepEqual(decideResourceRequest(undefined, RIN, { type: "approve", note: "" }, ADMINS, NOW).result, {
    ok: false,
    reason: "not_found",
  });
});

test("keeps a Need Info request open so it can still be approved", () => {
  const { update } = decideResourceRequest(request(), RIN, { type: "need_info", note: "Which days?" }, ADMINS, NOW);

  assert.equal(update?.status, "Need Info");
  assert.equal(decideResourceRequest(update, RIN, { type: "approve", note: "" }, ADMINS, NOW).result.ok, true);
});

test("an edit sends the request back to Pending and clears the decision", () => {
  const asked = request({ status: "Need Info", decidedBy: RIN, decisionNote: "Which days?" });
  const { update, result } = editResourceRequest(asked, SALES, input({ mandays: 1, endDate: "2026-12-02" }), ADMINS);

  assert.equal(result.ok && result.previous.status, "Need Info");
  assert.deepEqual(
    { status: update?.status, mandays: update?.mandays, decidedBy: update?.decidedBy, requestId: update?.requestId },
    { status: "Pending", mandays: 1, decidedBy: null, requestId: asked.requestId },
  );
});

test("only the requester or an admin may edit, and only while open", () => {
  assert.equal(editResourceRequest(request(), RIN, input(), ADMINS).result.ok, false);
  assert.equal(editResourceRequest(request(), ADMIN, input(), ADMINS).result.ok, true);

  const { result } = editResourceRequest(request({ status: "Approved" }), SALES, input(), ADMINS);
  assert.equal(result.ok ? "" : result.reason, "not_editable");
});

test("cancelling records who and why, even after approval", () => {
  const { update, result } = cancelResourceRequest(request({ status: "Approved" }), SALES, " demo postponed ", ADMINS, NOW);

  assert.equal(result.ok && result.previous.status, "Approved");
  assert.deepEqual(
    { status: update?.status, decidedBy: update?.decidedBy, decisionNote: update?.decisionNote },
    { status: "Cancelled", decidedBy: SALES, decisionNote: "demo postponed" },
  );
});

test("a rejected or cancelled request cannot be cancelled or approved", () => {
  for (const status of ["Rejected", "Cancelled"] as const) {
    const closed = request({ status });

    assert.equal(cancelResourceRequest(closed, SALES, "", ADMINS, NOW).result.ok, false);
    assert.equal(decideResourceRequest(closed, RIN, { type: "approve", note: "" }, ADMINS, NOW).result.ok, false);
  }
});

test("compares inclusive date ranges", () => {
  assert.equal(rangesOverlap({ start: "2026-12-01", end: "2026-12-04" }, { start: "2026-12-04", end: "2026-12-10" }), true);
  assert.equal(rangesOverlap({ start: "2026-12-01", end: "2026-12-04" }, { start: "2026-12-05", end: "2026-12-10" }), false);
});

test("finds approved and pending requests for the same person over the same dates", () => {
  const current = request();
  const approved = request({ project: "Beta", startDate: "2026-12-03", endDate: "2026-12-08", status: "Approved" });
  const pending = request({ project: "Gamma" });
  const others = [
    current,
    approved,
    pending,
    request({ personId: "U_OTHER" }),
    request({ startDate: "2026-12-14", endDate: "2026-12-15" }),
    request({ status: "Rejected" }),
  ];

  const overlaps = findOverlaps(current, others);

  assert.deepEqual(overlaps.approved.map((other) => other.project), ["Beta"]);
  assert.deepEqual(overlaps.pending.map((other) => other.requestId), [pending.requestId]);
});

test("sums approved borrowings by person, busiest first", () => {
  const people = summarizeBorrowed(
    [
      request({ personId: "U_A", mandays: 1, status: "Approved" }),
      request({ personId: "U_B", mandays: 2, project: "B1", status: "Approved" }),
      request({ personId: "U_B", mandays: 1, project: "B2", startDate: "2026-11-30", endDate: "2026-12-01", status: "Approved" }),
      request({ personId: "U_C", mandays: 3 }), // pending: not counted
      request({ personId: "U_D", status: "Cancelled" }),
      request({ personId: "U_E", startDate: "2027-01-04", endDate: "2027-01-05", status: "Approved" }),
    ],
    monthOf("2026-12-15"),
  );

  assert.deepEqual(people.map((person) => [person.personId, person.totalMandays]), [["U_B", 3], ["U_A", 1]]);
  assert.deepEqual(people[0].requests.map((r) => r.project), ["B2", "B1"]);
});

test("gets the calendar month, including February in a leap year", () => {
  assert.deepEqual(monthOf("2026-12-15"), { start: "2026-12-01", end: "2026-12-31" });
  assert.deepEqual(monthOf("2028-02-10"), { start: "2028-02-01", end: "2028-02-29" });
});

test("reads settings from the environment", () => {
  assert.deepEqual(
    getResourceRequestSettings({
      RESOURCE_REQUEST_CHANNEL_ID: " C1 ",
      RESOURCE_REQUEST_ADMIN_IDS: "U1, U2,",
    }),
    { channelId: "C1", adminIds: ["U1", "U2"], projects: [] },
  );
  assert.equal(getResourceRequestSettings({}).channelId, null);
});
