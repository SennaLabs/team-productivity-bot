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
  parseTimeWindow,
  rangesOverlap,
  summarizeBorrowed,
  timesOverlap,
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
  person: [EARTH],
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
      personIds: [EARTH],
      ownerPmId: RIN,
      project: "Acme",
      mandays: 1.5,
      startDate: "2026-12-01",
      endDate: "2026-12-04",
      startTime: null,
      endTime: null,
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

test("takes any whole number of minutes in any unit", () => {
  for (const [amount, unit, mandays] of [
    ["1", "minutes", 1 / 480],
    ["10", "minutes", 10 / 480],
    ["1.1", "hours", 66 / 480],
    ["1.25", "hours", 1.25 / 8],
    ["0.3", "mandays", 144 / 480],
    ["0.5", "mandays", 0.5],
    ["100", "mandays", 100],
    ["10.5", "minutes", null],
    ["0.01", "hours", null],
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
    [1 / 16, 1.25 / 8, 70 / 480, 1.5].map(toAmountInput),
    [
      { amount: "30", unit: "minutes" },
      { amount: "1.25", unit: "hours" },
      { amount: "70", unit: "minutes" },
      { amount: "1.5", unit: "mandays" },
    ],
  );
  // Minutes are not exact in a float; totals still read as whole minutes.
  assert.equal(formatAmount([7, 13, 40].reduce((sum, minutes) => sum + minutes / 480, 0)), "1 ชม.");
  assert.equal(formatAmount(7 / 480), "7 นาที");
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

test("takes an optional time window that applies to every day", () => {
  const oneDay = { ...FORM, start_date: "2027-07-02", end_date: "2027-07-02" }; // a Friday
  const ok = validateResourceRequestForm({ ...oneDay, amount: "1", unit: "hours", time_window: "13.00-14.00" });

  assert.ok(ok.ok);
  assert.deepEqual([ok.input.startTime, ok.input.endTime, ok.input.mandays], ["13:00", "14:00", 1 / 8]);

  const blank = validateResourceRequestForm({ ...oneDay, amount: "1", unit: "hours", time_window: "  " });
  assert.ok(blank.ok);
  assert.deepEqual([blank.input.startTime, blank.input.endTime], [null, null]);

  for (const time_window of ["14:00-13:00", "13:00-13:00", "25:00-26:00", "บ่ายโมง", "13:00"]) {
    const result = validateResourceRequestForm({ ...oneDay, amount: "30", unit: "minutes", time_window });
    assert.deepEqual(result.ok ? [] : Object.keys(result.errors), ["time_window"], time_window);
  }
});

test("reads the time window the way people type it", () => {
  for (const [text, window] of [
    ["13:00-14:00", ["13:00", "14:00"]],
    ["13.00-14.00", ["13:00", "14:00"]],
    ["13:30 - 14:15", ["13:30", "14:15"]],
    ["9-10", ["09:00", "10:00"]],
    ["9.30–10", ["09:30", "10:00"]],
    ["13.00 ถึง 14.00", ["13:00", "14:00"]],
  ] as const) {
    const parsed = parseTimeWindow(text);
    assert.deepEqual(parsed && [parsed.startTime, parsed.endTime], window, text);
  }

  for (const text of ["13:00", "13:60-14:00", "24:00-25:00", "1pm-2pm"]) {
    assert.equal(parseTimeWindow(text), null, text);
  }
});

test("caps the amount at the window on each working day", () => {
  // Tue 1 Dec to Fri 4 Dec is four working days of one hour each.
  const window = { ...FORM, time_window: "13:00-14:00" };

  assert.ok(validateResourceRequestForm({ ...window, amount: "4", unit: "hours" }).ok);
  assert.deepEqual(validateResourceRequestForm({ ...window, amount: "4.25", unit: "hours" }), {
    ok: false,
    errors: { amount: "ช่วงที่เลือกมีวันทำงาน 4 วัน วันละ 13:00–14:00 รวม 4 ชม. แต่ขอ 4 ชม. 15 นาที" },
  });
  // A window longer than eight hours still counts as one manday a day.
  assert.equal(validateResourceRequestForm({ ...FORM, amount: "4.25", time_window: "08:00-18:00" }).ok, false);
});

test("compares daily time windows; no window meets any window", () => {
  const window = (startTime: string | null, endTime: string | null) => ({ startTime, endTime });

  assert.equal(timesOverlap(window("13:00", "14:00"), window("13:30", "15:00")), true);
  assert.equal(timesOverlap(window("13:00", "14:00"), window("14:00", "15:00")), false);
  assert.equal(timesOverlap(window(null, null), window("09:00", "10:00")), true);

  const morning = request({ startTime: "09:00", endTime: "10:00", status: "Approved" });
  const afternoon = request({ startTime: "13:00", endTime: "14:00" });
  assert.deepEqual(findOverlaps(afternoon, [morning]).approved, []);
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
    request({ personIds: ["U_OTHER"] }),
    request({ startDate: "2026-12-14", endDate: "2026-12-15" }),
    request({ status: "Rejected" }),
  ];

  const overlaps = findOverlaps(current, others);

  assert.deepEqual(overlaps.approved.map((other) => other.project), ["Beta"]);
  assert.deepEqual(overlaps.pending.map((other) => other.requestId), [pending.requestId]);
});

test("validates the people to borrow", () => {
  const people = (person: string[]) => validateResourceRequestForm({ ...FORM, person });
  const twice = people([EARTH, "U_MOON", EARTH]);

  assert.ok(twice.ok);
  assert.deepEqual(twice.input.personIds, [EARTH, "U_MOON"]);
  const none = people([]);
  assert.deepEqual(none.ok ? null : Object.keys(none.errors), ["person"]);

  const eleven = people(Array.from({ length: 11 }, (_, index) => `U${index}`));
  assert.deepEqual(eleven.ok ? null : eleven.errors, { person: "เลือกได้ไม่เกิน 10 คนต่อคำขอ" });
});

test("a request for several people overlaps each of them and counts for each in /borrowed", () => {
  const pair = request({ personIds: ["U_A", "U_B"], mandays: 1, status: "Approved" });
  const forB = request({ personIds: ["U_B"] });

  assert.deepEqual(findOverlaps(forB, [pair]).approved.map((other) => other.requestId), [pair.requestId]);
  assert.deepEqual(findOverlaps(request({ personIds: ["U_C"] }), [pair]).approved, []);
  assert.deepEqual(
    summarizeBorrowed([pair], monthOf("2026-12-15")).map((person) => [person.personId, person.totalMandays]),
    [["U_A", 1], ["U_B", 1]],
  );
});

test("sums approved borrowings by person, busiest first", () => {
  const people = summarizeBorrowed(
    [
      request({ personIds: ["U_A"], mandays: 1, status: "Approved" }),
      request({ personIds: ["U_B"], mandays: 2, project: "B1", status: "Approved" }),
      request({ personIds: ["U_B"], mandays: 1, project: "B2", startDate: "2026-11-30", endDate: "2026-12-01", status: "Approved" }),
      request({ personIds: ["U_C"], mandays: 3 }), // pending: not counted
      request({ personIds: ["U_D"], status: "Cancelled" }),
      request({ personIds: ["U_E"], startDate: "2027-01-04", endDate: "2027-01-05", status: "Approved" }),
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
