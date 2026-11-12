import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBorrowedMessage,
  createResourceRequestCard,
  decodeManageValue,
  describeChanges,
  formatDateRange,
  notices,
  RESOURCE_REQUEST_IDS,
} from "./messages.ts";
import {
  createApproveModal,
  createResourceRequestModal,
  readResourceRequestForm,
} from "./modals.ts";
import { newResourceRequest } from "./requests.ts";
import { toResourceRequest } from "../repositories/resource-request-records.ts";
import type { ResourceRequest } from "@/models/resource-request";
import type { SlackInteractionPayload } from "@/models/slack-api";

const RIN = "U_RIN";
const EARTH = "U_EARTH";
const SALES = "U_SALES";

function request(overrides: Partial<ResourceRequest> = {}): ResourceRequest {
  return {
    ...newResourceRequest(
      {
        personId: EARTH,
        ownerPmId: RIN,
        project: "Acme App",
        mandays: 2,
        startDate: "2026-12-01",
        endDate: "2026-12-04",
        startTime: null,
        endTime: null,
        urgency: "Normal",
        reason: "Demo",
      },
      "RR-ABCDEF",
      { id: SALES, name: "Sales" },
      new Date("2026-11-11T03:00:00Z"),
    ),
    ...overrides,
  };
}

const hasDecisionButtons = (r: ResourceRequest) =>
  JSON.stringify(createResourceRequestCard(r)).includes(`"action_id":"${RESOURCE_REQUEST_IDS.approveButton}"`);

function menuValues(r: ResourceRequest) {
  const actions = createResourceRequestCard(r).blocks.find((block) => block.type === "actions") as
    | { elements: { type: string; options?: { value: string }[] }[] }
    | undefined;

  return actions?.elements.find((element) => element.type === "overflow")?.options?.map((option) => option.value) ?? [];
}

test("the card tags the requester, the person and their PM", () => {
  const text = JSON.stringify(createResourceRequestCard(request()));

  for (const id of [SALES, EARTH, RIN]) {
    assert.ok(text.includes(`<@${id}>`), id);
  }
});

test("the card shows decision buttons only while the request is open", () => {
  assert.equal(hasDecisionButtons(request()), true);
  assert.equal(hasDecisionButtons(request({ status: "Need Info" })), true);
  assert.equal(hasDecisionButtons(request({ status: "Approved" })), false);
  assert.equal(hasDecisionButtons(request({ status: "Rejected" })), false);
});

test("the menu offers edit and cancel while open, only cancel once approved", () => {
  assert.deepEqual(menuValues(request()), ["edit:RR-ABCDEF", "cancel:RR-ABCDEF"]);
  assert.deepEqual(menuValues(request({ status: "Approved" })), ["cancel:RR-ABCDEF"]);
  assert.deepEqual(menuValues(request({ status: "Cancelled" })), []);
  assert.deepEqual(decodeManageValue("edit:RR-ABCDEF"), { choice: "edit", requestId: "RR-ABCDEF" });
  assert.equal(decodeManageValue("delete:RR-ABCDEF"), null);
});

test("user text is escaped so it cannot ping the channel", () => {
  const text = JSON.stringify(createResourceRequestCard(request({ reason: "ping <!channel> & <@U123>" })));

  assert.ok(!text.includes("<!channel>"));
  assert.ok(text.includes("&lt;!channel&gt; &amp; &lt;@U123&gt;"));
});

test("every Slack ID starts with the prefix the interaction router looks for", () => {
  for (const id of Object.values(RESOURCE_REQUEST_IDS)) {
    assert.ok(id.startsWith("resource_request_"), id);
  }
});

test("the approve modal warns about overlapping approved mandays", () => {
  const other = request({ requestId: "RR-OTHER1", project: "Beta", mandays: 1.5, status: "Approved" });
  const modal = JSON.stringify(createApproveModal(request(), { approved: [other], pending: [] }));

  assert.ok(modal.includes("ถูกยืมไปแล้ว 1.5 manday"));
  assert.ok(modal.includes("Beta"));
  assert.ok(!JSON.stringify(createApproveModal(request(), { approved: [], pending: [] })).includes(":warning:"));
});

test("the edit form is prefilled and tied to the request", () => {
  const existing = request({ mandays: 1.5, reason: "Fix login", project: "Old project" });
  const modal = createResourceRequestModal(["Acme App"], existing);
  const json = JSON.stringify(modal);

  assert.equal(modal.callback_id, RESOURCE_REQUEST_IDS.editModal);
  assert.equal(modal.private_metadata, "RR-ABCDEF");

  for (const value of [
    `"initial_user":"${EARTH}"`,
    `"initial_user":"${RIN}"`,
    '"initial_value":"1.5"',
    '"initial_option":{"text":{"type":"plain_text","text":"manday","emoji":true},"value":"mandays"}',
    '"initial_date":"2026-12-01"',
    '"initial_value":"Fix login"',
    // A project removed from the list since is kept.
    '"initial_option":{"text":{"type":"plain_text","text":"Old project"',
  ]) {
    assert.ok(json.includes(value), value);
  }
});

test("reads the submitted form back from Slack's view state", () => {
  const payload: SlackInteractionPayload = {
    type: "view_submission",
    view: {
      state: {
        values: {
          person: { value: { selected_user: EARTH } },
          project: { value: { selected_option: { value: "Acme App" } } },
          amount: { value: { value: "1.5" } },
          unit: { value: { selected_option: { value: "hours" } } },
          start_date: { value: { selected_date: "2026-12-01" } },
          start_time: { value: { selected_time: "13:00" } },
        },
      },
    },
  };

  assert.deepEqual(readResourceRequestForm(payload), {
    person: EARTH,
    owner_pm: undefined,
    project: "Acme App",
    amount: "1.5",
    unit: "hours",
    start_date: "2026-12-01",
    end_date: undefined,
    start_time: "13:00",
    end_time: undefined,
    urgency: undefined,
    reason: undefined,
  });
});

test("shows a daily time window with the dates", () => {
  const oneDay = request({ startDate: "2027-07-03", endDate: "2027-07-03", startTime: "13:00", endTime: "14:00" });
  const days = request({ startTime: "09:30", endTime: "10:00" });
  const card = JSON.stringify(createResourceRequestCard(oneDay));

  assert.ok(card.includes("2027-07-03 13:00–14:00"));
  assert.ok(JSON.stringify(createResourceRequestCard(days)).includes("2026-12-01 → 2026-12-04 เวลา 09:30–10:00 ทุกวัน"));
  assert.equal(formatDateRange(request()), "2026-12-01 → 2026-12-04");
  assert.deepEqual(describeChanges(request(), oneDay).filter((line) => line.startsWith("เวลา")), ["เวลา: ไม่ระบุ → 13:00–14:00"]);
});

test("the edit form keeps the time window", () => {
  const json = JSON.stringify(createResourceRequestModal([], request({ startTime: "13:00", endTime: "14:00" })));

  assert.ok(json.includes('"initial_time":"13:00"'));
  assert.ok(json.includes('"initial_time":"14:00"'));
  assert.ok(!JSON.stringify(createResourceRequestModal([], request())).includes("initial_time"));
});

test("describes what an edit changed", () => {
  const before = request();
  const after = { ...before, mandays: 3, ownerPmId: "U_NEW", reason: "changed" };

  assert.deepEqual(describeChanges(before, after), ["PM: <@U_RIN> → <@U_NEW>", "จำนวน: 2 manday → 3 manday", "แก้รายละเอียดงาน"]);
  assert.deepEqual(describeChanges(before, before), []);
});

test("a cancelled approval tells the borrowed person they are free", () => {
  const cancelled = request({ status: "Cancelled", decisionNote: "client postponed" });

  assert.ok(notices.cancelled(cancelled, request({ status: "Approved" }), SALES).includes(`<@${EARTH}> ไม่ต้องไปช่วย`));
  assert.ok(!notices.cancelled(cancelled, request(), SALES).includes(`<@${EARTH}>`));
});

test("the /borrowed reply handles an empty range and caps very long lists", () => {
  assert.ok(JSON.stringify(createBorrowedMessage([], "title")).includes("ไม่มีใครถูกยืม"));

  const many = Array.from({ length: 60 }, (_, index) => ({ personId: `U${index}`, totalMandays: 1, requests: [] }));
  const message = createBorrowedMessage(many, "title");

  assert.ok(message.blocks.length <= 50);
  assert.ok(JSON.stringify(message).includes("แสดง 45 จาก 60 คน"));
});

test("a stored record round-trips and tolerates bad fields", () => {
  const original = request({ status: "Approved", decidedBy: RIN, channelId: "C1", messageTs: "1.2" });

  assert.deepEqual(toResourceRequest(original.requestId, { ...original }), original);

  const repaired = toResourceRequest("RR-XYZ234", { status: "???", mandays: "2" });
  assert.equal(repaired.requestId, "RR-XYZ234");
  assert.equal(repaired.status, "Pending");
  assert.equal(repaired.mandays, 0);
});
