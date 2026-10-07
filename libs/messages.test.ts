import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIssueMessage,
  createPrMergedMessage,
  createPrMergedUpdate,
  createPrMessage,
  decodeActionValue,
  decodePrMergedAction,
  decodeWatcherUserIds,
  DEFAULT_PR_PRIORITY,
  encodeActionValue,
  isMessageOwner,
  MAX_WATCHER_COUNT,
  MAX_WATCHER_NOTE_LENGTH,
  parsePrPriority,
  PR_PRIORITIES,
} from "./messages.ts";
import type { PrSubmission } from "@/models/slack-api";

type AnyBlock = {
  type?: string;
  block_id?: string;
  text?: { text: string };
};

function blockOfType(message: { blocks: unknown[] }, type: string) {
  return message.blocks.find((block) => (block as AnyBlock).type === type) as
    | AnyBlock
    | undefined;
}

function prBody(message: { blocks: unknown[] }) {
  return blockOfType(message, "section")?.text?.text ?? "";
}

function prSubmission(overrides: Partial<PrSubmission> = {}): PrSubmission {
  return {
    channel: { channelId: "C1", channelName: "dev" },
    userId: "U1",
    ticketLinks: ["https://jira/PROJ-1"],
    prUrl: "https://github.com/org/repo/pull/7",
    priority: "normal",
    reviewerUserIds: ["U2", "U3"],
    watcherUserIds: [],
    mergeNotifyMinutes: 0,
    ...overrides,
  };
}

test("mentions the owner and every reviewer", () => {
  const message = createPrMessage(prSubmission());
  const { text } = message;
  const body = prBody(message);

  assert.match(body, /\*Owner PR:\* <@U1>/);
  assert.match(body, /\*Reviewer:\* <@U2>, <@U3>/);
  assert.match(text, /https:\/\/github\.com\/org\/repo\/pull\/7/);
});

test("posts the PR URL bare so Slack can autolink and unfurl it", () => {
  const body = prBody(createPrMessage(prSubmission()));

  assert.match(body, /\*PR:\* https:\/\/github\.com\/org\/repo\/pull\/7\n/);
});

test("posts a GitLab or Azure PR URL unchanged", () => {
  for (const prUrl of [
    "https://gitlab.com/group/project/-/merge_requests/42",
    "https://dev.azure.com/org/project/_git/repo/pullrequest/42",
  ]) {
    const body = prBody(createPrMessage(prSubmission({ prUrl })));

    assert.ok(body.includes(prUrl), `${prUrl} should appear verbatim`);
  }
});

test("lists multiple tickets as bullets and a single one inline", () => {
  const one = prBody(createPrMessage(prSubmission()));
  assert.match(one, /\*Ticket:\* https:\/\/jira\/PROJ-1\n/);

  const many = prBody(createPrMessage(prSubmission({ ticketLinks: ["a", "b"] })));
  assert.match(many, /\*Ticket:\* \n• a\n• b\n/);
});

test("falls back to - when no ticket was given", () => {
  const body = prBody(createPrMessage(prSubmission({ ticketLinks: [] })));

  assert.match(body, /\*Ticket:\* -/);
});

test("escapes ticket text so it cannot forge mentions or links", () => {
  const body = prBody(
    createPrMessage(
      prSubmission({ ticketLinks: ["<@U999> <https://evil.com|click> & more"] }),
    ),
  );

  assert.ok(!body.includes("<@U999>"), "raw mention must not survive");
  assert.ok(!body.includes("<https://evil.com|click>"), "raw link must not survive");
  assert.match(body, /&lt;@U999&gt;/);
  assert.match(body, /&amp; more/);
});

test("handles no reviewers without producing an empty field", () => {
  const body = prBody(createPrMessage(prSubmission({ reviewerUserIds: [] })));

  assert.match(body, /\*Reviewer:\* -/);
});

const TOOLING_URL =
  "https://toolings.co/company/2/projects/387?bust=undefined&memberIds=213&selectedTicketId=113263";

function ticketText(ticketLinks: string[]) {
  return prBody(createPrMessage(prSubmission({ ticketLinks })));
}

test("turns [label](url) into a Slack hyperlink", () => {
  const body = ticketText([`[FE (Mobile) : Interface stock](${TOOLING_URL})`]);

  assert.match(body, /<https:\/\/toolings\.co\/company\/2\/projects\/387\?/);
  assert.match(body, /\|FE \(Mobile\) : Interface stock>/);
});

test("escapes ampersands in the link URL so Slack keeps the query string", () => {
  const body = ticketText([`[ticket](${TOOLING_URL})`]);

  assert.ok(!/[^m]&(?!amp;)/.test(body), "raw & must be escaped as &amp;");
  assert.match(body, /bust=undefined&amp;memberIds=213/);
});

test("hyperlinks each entry when several are given", () => {
  const body = ticketText([
    "[one](https://toolings.co/a)",
    "[two](https://toolings.co/b)",
  ]);

  assert.match(body, /• <https:\/\/toolings\.co\/a\|one>/);
  assert.match(body, /• <https:\/\/toolings\.co\/b\|two>/);
});

test("leaves plain text and bare URLs alone for Slack to autolink", () => {
  assert.match(ticketText(["PROJ-123 needs backport"]), /PROJ-123 needs backport/);
  assert.match(ticketText(["https://toolings.co/a"]), /\*Ticket:\* https:\/\/toolings\.co\/a/);
});

test("refuses to build a link from a non-http scheme", () => {
  for (const hostile of [
    "[click](javascript:alert(1))",
    "[click](data:text/html,<script>)",
    "[click](slack://channel?id=C1)",
  ]) {
    const body = ticketText([hostile]);
    assert.ok(!body.includes("|click>"), `${hostile} must not become a link`);
  }
});

test("escapes a label that tries to close the link early", () => {
  const body = ticketText(["[a>b <@U999>](https://toolings.co/a)"]);

  assert.ok(!body.includes("<@U999>"), "raw mention must not survive");
  assert.match(body, /\|a&gt;b &lt;@U999&gt;>/);
});

type OverflowBlock = {
  type: string;
  block_id?: string;
  elements: {
    type?: string;
    action_id?: string;
    style?: string;
    value?: string;
    text?: { text: string };
    options?: { text: { text: string }; value?: string }[];
    confirm?: unknown;
  }[];
};

function prActions(
  watcherUserIds: string[],
  overrides: Partial<PrSubmission> = {},
) {
  return blockOfType(
    createPrMessage(prSubmission({ watcherUserIds, ...overrides })),
    "actions",
  ) as unknown as OverflowBlock;
}

function prMergedButton(
  watcherUserIds: string[],
  overrides: Partial<PrSubmission> = {},
) {
  return prActions(watcherUserIds, overrides).elements.find(
    (element) => element.action_id === "pr_merged",
  );
}

function prDeleteOption(watcherUserIds: string[]) {
  return prActions(watcherUserIds)
    .elements.find((element) => element.action_id === "pr_overflow")
    ?.options?.[0];
}

test("keeps Merged as a button and puts Delete in the overflow", () => {
  const block = prActions([]);

  assert.equal(block.type, "actions");
  assert.deepEqual(
    block.elements.map((element) => [element.type, element.action_id]),
    [
      ["button", "pr_merged"],
      ["overflow", "pr_overflow"],
    ],
  );
  assert.equal(block.elements[0].text?.text, "Merged");
  assert.deepEqual(
    block.elements[1].options?.map((option) => option.text.text),
    ["Delete"],
  );
});

test("never mentions watchers in the posted message", () => {
  const message = createPrMessage(
    prSubmission({ watcherUserIds: ["U_WATCH1", "U_WATCH2"] }),
  );
  const { text } = message;
  const body = prBody(message);

  assert.ok(!body.includes("U_WATCH1"), "watcher must not appear in the body");
  assert.ok(!body.includes("U_WATCH2"), "watcher must not appear in the body");
  assert.ok(!text.includes("U_WATCH1"), "watcher must not appear in the fallback text");
  assert.ok(!body.includes("Watcher"), "no watcher field should be rendered");
});

test("carries the watchers on the Merged button instead", () => {
  const merged = prMergedButton(["U_WATCH1", "U_WATCH2"]);

  assert.deepEqual(
    decodeWatcherUserIds(decodeActionValue(merged?.value)?.fields[0]),
    ["U_WATCH1", "U_WATCH2"],
  );
});

test("keeps the Merged button usable when nobody is watching", () => {
  const merged = prMergedButton([]);

  assert.deepEqual(
    decodePrMergedAction(decodeActionValue(merged?.value)?.fields ?? []),
    { watcherUserIds: [], notifyAfterMinutes: 0, watcherNote: undefined },
  );
});

test("carries the delay and a note containing colons on the Merged button", () => {
  const merged = prMergedButton(["U_W1"], {
    mergeNotifyMinutes: 15,
    watcherNote: "staging: ready at 10:30",
  });

  assert.deepEqual(
    decodePrMergedAction(decodeActionValue(merged?.value)?.fields ?? []),
    {
      watcherUserIds: ["U_W1"],
      notifyAfterMinutes: 15,
      watcherNote: "staging: ready at 10:30",
    },
  );
});

test("reads a Merged button posted before delay and note existed", () => {
  assert.deepEqual(
    decodePrMergedAction(decodeActionValue("merged:U_W1,U_W2")?.fields ?? []),
    { watcherUserIds: ["U_W1", "U_W2"], notifyAfterMinutes: 0, watcherNote: undefined },
  );
});

test("clamps a delay beyond the 60 minute cap", () => {
  assert.equal(decodePrMergedAction(["U_W1", "999"]).notifyAfterMinutes, 60);
});

test("treats a negative or non-numeric delay as posting now", () => {
  assert.equal(decodePrMergedAction(["U_W1", "-5"]).notifyAfterMinutes, 0);
  assert.equal(decodePrMergedAction(["U_W1", "abc"]).notifyAfterMinutes, 0);
});

test("keeps full watchers and a full note inside Slack's 2000 char button cap", () => {
  const userIds = Array.from(
    { length: MAX_WATCHER_COUNT },
    (_, index) => `U${String(index).padStart(10, "0")}`,
  );

  assert.ok(
    (
      prMergedButton(userIds, {
        mergeNotifyMinutes: 60,
        watcherNote: "ก".repeat(MAX_WATCHER_NOTE_LENGTH),
      })?.value ?? ""
    ).length <= 2000,
    `${MAX_WATCHER_COUNT} watchers and a full note must fit in a button value`,
  );
});

test("guards the Delete overflow behind a confirmation dialog", () => {
  assert.ok(
    prActions([]).elements[1].confirm,
    "picking Delete must ask before destroying the thread",
  );
});

test("mentions every watcher in the merged thread reply", () => {
  const { text, blocks } = createPrMergedMessage(["U_W1", "U_W2"]);
  const body = (blocks[0] as { text: { text: string } }).text.text;

  assert.equal(body, "*Already merged* <@U_W1>, <@U_W2>");
  assert.match(text, /<@U_W1>, <@U_W2>/);
});

test("puts the watcher note under the mentions, escaped", () => {
  const { blocks } = createPrMergedMessage(["U_W1"], "ดู <!here> ด้วย");
  const body = (blocks[0] as { text: { text: string } }).text.text;

  assert.equal(body, "*Already merged* <@U_W1>\nดู &lt;!here&gt; ด้วย");
});

test("decodes defensively around stray separators and spacing", () => {
  assert.deepEqual(decodeWatcherUserIds(" U1 , ,U2, "), ["U1", "U2"]);
  assert.deepEqual(decodeWatcherUserIds(""), []);
});



test("only the owner may delete", () => {
  assert.equal(isMessageOwner("U_OWNER", "U_OWNER"), true);
  assert.equal(isMessageOwner("U_OWNER", "U_SOMEONE_ELSE"), false);
});

test("nobody may delete when the owner id is missing or unknown", () => {
  // Fail closed rather than letting an unattributed message be deleted by anyone.
  assert.equal(isMessageOwner(undefined, "U_OWNER"), false);
  assert.equal(isMessageOwner("", "U_OWNER"), false);
  assert.equal(isMessageOwner("U_OWNER", undefined), false);
  assert.equal(isMessageOwner(undefined, undefined), false);
});

test("the Delete option carries the owner id", () => {
  assert.equal(decodeActionValue(prDeleteOption([])?.value)?.fields[0], "U1");
});

function mergedBlocks(mergedBy: string | undefined = "U_MERGER") {
  const posted = createPrMessage(prSubmission({ watcherUserIds: ["U_W1"] }));

  return createPrMergedUpdate(posted, mergedBy).blocks as {
    type: string;
    block_id?: string;
    elements?: {
      action_id?: string;
      options?: { text: { text: string }; value?: string }[];
      text?: string;
    }[];
  }[];
}

test("removes the Merged button so it cannot be pressed twice", () => {
  const actions = mergedBlocks().find((block) => block.block_id === "pr_actions");

  assert.deepEqual(
    actions?.elements?.map((element) => element.action_id),
    ["pr_overflow"],
    "only the Delete overflow should remain",
  );
});

test("keeps Delete working after a merge by preserving its owner value", () => {
  const actions = mergedBlocks().find((block) => block.block_id === "pr_actions");
  const remove = actions?.elements?.[0].options?.[0];

  assert.equal(decodeActionValue(remove?.value)?.fields[0], "U1");
});

test("drops the whole actions block when a merge leaves nothing behind", () => {
  const { blocks } = createPrMergedUpdate(
    {
      text: "x",
      blocks: [
        {
          type: "actions",
          block_id: "pr_actions",
          elements: [
            { type: "button", action_id: "pr_merged", value: "merged:" },
          ],
        },
      ],
    },
    "U_MERGER",
  );

  // Slack rejects an actions block with zero elements, so it must go entirely.
  assert.deepEqual(
    blocks.map((block) => (block as { block_id?: string }).block_id),
    ["pr_merged_marker"],
  );
});

test("leaves a merged marker naming who merged it", () => {
  const marker = mergedBlocks().find(
    (block) => block.block_id === "pr_merged_marker",
  );

  assert.equal(marker?.type, "context");
  assert.match(
    marker?.elements?.[0].text ?? "",
    /:white_check_mark: \*Merged\* โดย <@U_MERGER>/,
  );
});

test("keeps the original PR details visible after merging", () => {
  const body =
    (mergedBlocks().find((block) => block.type === "section") as unknown as {
      text: { text: string };
    }).text.text;

  assert.match(body, /\*Owner PR:\* <@U1>/);
  assert.match(body, /\*PR:\* https:\/\/github\.com\/org\/repo\/pull\/7/);
});

test("marks the fallback text as merged too", () => {
  const posted = createPrMessage(prSubmission());

  assert.equal(
    createPrMergedUpdate(posted, "U_MERGER").text,
    `${posted.text} · Merged`,
  );
});

test("still produces a marker when Slack sends no blocks back", () => {
  const { blocks, text } = createPrMergedUpdate({}, "U_MERGER");

  assert.equal(text, "Merged");
  assert.deepEqual(
    blocks.map((block) => (block as { block_id?: string }).block_id),
    ["pr_merged_marker"],
  );
});

function issueActions(issueId: string, userId: string | undefined) {
  const message = createIssueMessage(
    {
      channel: { channelId: "C1", channelName: "dev" },
      userId,
      problem: "build พัง",
      blocking: "deploy ไม่ได้",
      askUserIds: ["U_ASK"],
      need: "ช่วยดู CI",
      minutes: 15,
      createdDate: "2026-09-22",
      timezone: "Asia/Bangkok",
    },
    issueId,
  );

  return { message, actions: message.blocks[1] as OverflowBlock };
}

test("round-trips an action and its fields through an option value", () => {
  assert.equal(
    encodeActionValue("delete", "U_OWNER", "ROW123"),
    "delete:U_OWNER:ROW123",
  );
  assert.deepEqual(decodeActionValue("delete:U_OWNER:ROW123"), {
    action: "delete",
    fields: ["U_OWNER", "ROW123"],
  });
});

test("encodes a missing field as empty rather than dropping it", () => {
  // Keeps field positions stable so fields[1] is always the row id.
  assert.equal(encodeActionValue("delete", undefined, "ROW123"), "delete::ROW123");
  assert.deepEqual(decodeActionValue("delete::ROW123")?.fields, ["", "ROW123"]);
});

test("decodes nothing from an absent value", () => {
  assert.equal(decodeActionValue(undefined), null);
  assert.equal(decodeActionValue(""), null);
});

test("gives the issue message a single confirmed Delete option", () => {
  const { actions } = issueActions("ISSUE_DOC_ID", "U_OWNER");

  assert.equal(actions.type, "actions");
  assert.equal(actions.block_id, "issue_actions");
  assert.equal(actions.elements[0].type, "overflow");
  assert.equal(actions.elements[0].action_id, "issue_overflow");
  assert.deepEqual(
    actions.elements[0].options?.map((option) => option.text.text),
    ["Delete"],
  );
  assert.ok(actions.elements[0].confirm, "deleting a stored row must be confirmed");
});

test("carries both ids so the row can be found and the click authorised", () => {
  const { actions } = issueActions("ROW123", "U_OWNER");
  const [ownerUserId, issueId] =
    decodeActionValue(actions.elements[0].options?.[0].value)?.fields ?? [];

  assert.equal(issueId, "ROW123");
  assert.equal(isMessageOwner(ownerUserId, "U_OWNER"), true);
  assert.equal(isMessageOwner(ownerUserId, "U_ASK"), false);
});

test("leaves the issue Delete option inert when the owner is unknown", () => {
  const { actions } = issueActions("ROW123", undefined);
  const [ownerUserId] =
    decodeActionValue(actions.elements[0].options?.[0].value)?.fields ?? [];

  assert.equal(ownerUserId, "");
  assert.equal(isMessageOwner(ownerUserId, "U_ANYONE"), false);
});

test("keeps the existing issue details untouched", () => {
  const body = (issueActions("ISSUE_DOC_ID", "U_OWNER").message.blocks[0] as unknown as { text: { text: string } }).text.text;

  assert.match(body, /\*Owner issue:\* <@U_OWNER>/);
  assert.match(body, /\*Problem:\* build พัง/);
  assert.match(body, /\*Ask:\* <@U_ASK>/);
});

test("every priority fits Slack's 75 char option limits", () => {
  for (const priority of PR_PRIORITIES) {
    const label = `${priority.emoji} *${priority.label}* · ${priority.note}`;

    assert.ok(label.length <= 75, `${priority.value} label is ${label.length} chars`);
    assert.ok(
      priority.sla.length <= 75,
      `${priority.value} description is ${priority.sla.length} chars`,
    );
  }
});

test("parses each known priority and falls back for anything else", () => {
  for (const priority of PR_PRIORITIES) {
    assert.equal(parsePrPriority(priority.value), priority.value);
  }

  for (const unknown of [undefined, "", "blocker", "NORMAL"]) {
    assert.equal(parsePrPriority(unknown), DEFAULT_PR_PRIORITY);
  }
});

test("folds every level into the existing lines", () => {
  for (const priority of PR_PRIORITIES) {
    const message = createPrMessage(prSubmission({ priority: priority.value }));
    const body = prBody(message);

    assert.equal(
      blockOfType(message, "header"),
      undefined,
      `${priority.value} must not add a header block`,
    );
    assert.ok(
      !body.includes(priority.sla),
      "the English deadline stays in the modal only",
    );
    // The dot leads the first line and the label closes the reviewer line.
    assert.match(body, new RegExp(`^${priority.emoji} \\*Owner PR:\\*`));
    assert.match(
      body,
      new RegExp(`\\*Reviewer:\\* <@U2>, <@U3> · \\*${priority.label}\\* — ${priority.note}`),
    );
  }
});

test("keeps every request to four lines whatever its urgency", () => {
  for (const priority of PR_PRIORITIES) {
    const body = prBody(createPrMessage(prSubmission({ priority: priority.value })));

    assert.equal(
      body.trimEnd().split("\n").length,
      4,
      `${priority.value} should still render four lines`,
    );
  }
});

test("adds no block beyond the details and the actions", () => {
  const message = createPrMessage(prSubmission({ priority: "critical" }));

  assert.deepEqual(
    message.blocks.map((block) => (block as AnyBlock).type),
    ["section", "actions"],
  );
});

test("carries the priority into the notification fallback text", () => {
  assert.match(
    createPrMessage(prSubmission({ priority: "critical" })).text,
    /^\[Critical\] ขอรีวิว PR:/,
  );
});

