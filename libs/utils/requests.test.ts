import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import {
  isValidSlackRequest,
  parsePrUrl,
  resolvePrPostAt,
  splitTicketLinks,
} from "./requests.ts";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const BODY = "payload=%7B%22type%22%3A%22block_actions%22%7D";

function slackRequest(
  body: string,
  {
    secret = SECRET,
    timestamp = Math.floor(Date.now() / 1000),
    signature,
  }: { secret?: string; timestamp?: number; signature?: string } = {},
) {
  const sig =
    signature ??
    `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;

  return new Request("https://example.com/api/slack/interactions", {
    method: "POST",
    headers: {
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": sig,
    },
    body,
  });
}

afterEach(() => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
});
process.env.SLACK_SIGNING_SECRET = SECRET;

test("accepts a correctly signed Slack request", () => {
  assert.equal(isValidSlackRequest(slackRequest(BODY), BODY), true);
});

test("rejects when the configured secret is wrong", () => {
  const request = slackRequest(BODY, { secret: "0000000000000000000000000000cafe" });
  assert.equal(isValidSlackRequest(request, BODY), false);
});

test("rejects a secret stored with wrapping quotes", () => {
  const request = slackRequest(BODY);
  process.env.SLACK_SIGNING_SECRET = `"${SECRET}"`;
  assert.equal(isValidSlackRequest(request, BODY), false);
});

test("rejects a secret stored with a trailing newline", () => {
  const request = slackRequest(BODY);
  process.env.SLACK_SIGNING_SECRET = `${SECRET}\n`;
  assert.equal(isValidSlackRequest(request, BODY), false);
});

test("rejects when SLACK_SIGNING_SECRET is unset", () => {
  const request = slackRequest(BODY);
  delete process.env.SLACK_SIGNING_SECRET;
  assert.equal(isValidSlackRequest(request, BODY), false);
});

test("rejects a replayed request older than 5 minutes", () => {
  const stale = Math.floor(Date.now() / 1000) - 60 * 6;
  assert.equal(isValidSlackRequest(slackRequest(BODY, { timestamp: stale }), BODY), false);
});

test("rejects a tampered body", () => {
  const request = slackRequest(BODY);
  assert.equal(isValidSlackRequest(request, `${BODY}&evil=1`), false);
});

test("rejects missing signature headers", () => {
  const bare = new Request("https://example.com/api/slack/interactions", { method: "POST", body: BODY });
  assert.equal(isValidSlackRequest(bare, BODY), false);
});

test("accepts pull request URLs from any host", () => {
  for (const url of [
    "https://github.com/org/repo/pull/42",
    "https://gitlab.com/group/project/-/merge_requests/42",
    "https://dev.azure.com/org/project/_git/repo/pullrequest/42",
    "https://bitbucket.org/org/repo/pull-requests/42",
    "https://git.company.internal:8443/org/repo/pull/42",
    "http://localhost:3000/org/repo/pull/42",
  ]) {
    assert.equal(parsePrUrl(url), url, `${url} should be accepted`);
  }
});

test("keeps the query string and fragment intact", () => {
  const url = "https://dev.azure.com/org/proj/_git/repo/pullrequest/7?_a=files#path=/x";

  assert.equal(parsePrUrl(url), url);
});

test("tolerates surrounding whitespace", () => {
  assert.equal(
    parsePrUrl("  https://github.com/org/repo/pull/7  "),
    "https://github.com/org/repo/pull/7",
  );
});

test("rejects empty input and anything that is not an http(s) URL", () => {
  for (const bad of [
    undefined,
    "",
    "   ",
    "not a url",
    "github.com/org/repo/pull/7",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "slack://channel?id=C1",
    "file:///etc/passwd",
  ]) {
    assert.equal(parsePrUrl(bad), null, `${bad} should be rejected`);
  }
});

test("splits ticket links one per line and drops blanks", () => {
  assert.deepEqual(
    splitTicketLinks("  https://jira/PROJ-1 \n\n https://jira/PROJ-2  \r\n"),
    ["https://jira/PROJ-1", "https://jira/PROJ-2"],
  );
});

test("keeps free text on a line intact instead of splitting on spaces", () => {
  assert.deepEqual(splitTicketLinks("PROJ-123 needs backport"), [
    "PROJ-123 needs backport",
  ]);
});

test("returns an empty list when no tickets were given", () => {
  assert.deepEqual(splitTicketLinks(undefined), []);
  assert.deepEqual(splitTicketLinks("   \n  "), []);
});

test("schedules Tomorrow 09:00 on the next calendar day in the team timezone", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  const tomorrow = (now: string) =>
    resolvePrPostAt("tomorrow", undefined, new Date(now), "Asia/Bangkok");

  assert.deepEqual(tomorrow("2026-10-05T20:00:00+07:00"), {
    postAt: at("2026-10-06T09:00:00+07:00"),
  });
  // 00:30 Bangkok is still the previous day in UTC — tomorrow must follow Bangkok.
  assert.deepEqual(tomorrow("2026-10-06T00:30:00+07:00"), {
    postAt: at("2026-10-07T09:00:00+07:00"),
  });
  assert.deepEqual(tomorrow("2026-10-31T10:00:00+07:00"), {
    postAt: at("2026-11-01T09:00:00+07:00"),
  });
});

test("sends now unless Tomorrow or Custom is picked", () => {
  assert.deepEqual(resolvePrPostAt("now", 1), { postAt: null });
  assert.deepEqual(resolvePrPostAt(undefined, 1), { postAt: null });
});

test("accepts only a Custom time between 1 minute and 120 days ahead", () => {
  const now = new Date("2026-10-05T10:00:00Z");
  const nowSeconds = now.getTime() / 1000;
  const custom = (seconds: number | undefined) =>
    resolvePrPostAt("custom", seconds, now);

  assert.ok("error" in custom(undefined));
  assert.ok("error" in custom(nowSeconds - 300));
  assert.ok("error" in custom(nowSeconds + 30));
  assert.ok("error" in custom(nowSeconds + 121 * 24 * 60 * 60));
  assert.deepEqual(custom(nowSeconds + 3600), { postAt: nowSeconds + 3600 });
});
