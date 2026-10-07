import assert from "node:assert/strict";
import { test } from "node:test";
import { getSlackMember, listSlackChannelMembers } from "./client.ts";

process.env.SLACK_BOT_TOKEN = "xoxb-test";

function stubSlack(pages: Record<string, unknown[]>) {
  const requests: { method: string; body: unknown }[] = [];

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const method = url.split("/").pop() ?? "";
    requests.push({ method, body: init.body });

    return Response.json({ ok: true, ...(pages[method]?.shift() as object) });
  }) as typeof fetch;

  return requests;
}

test("sends users.info form-encoded so Slack reads the user argument", async () => {
  const requests = stubSlack({
    "users.info": [{ user: { id: "U1", profile: { display_name: "Pack" } } }],
  });

  assert.deepEqual(await getSlackMember("U1", "test"), { id: "U1", name: "Pack" });
  assert.ok(requests[0].body instanceof URLSearchParams);
  assert.equal((requests[0].body as URLSearchParams).get("user"), "U1");
});

test("syncs only active humans in the channel, across every page", async () => {
  stubSlack({
    "conversations.members": [
      { members: ["U1", "U2"], response_metadata: { next_cursor: "next" } },
      { members: ["B1", "U3"] },
    ],
    "users.list": [
      {
        members: [
          { id: "U1", profile: { display_name: "Pack" } },
          { id: "U2", real_name: "Gone", deleted: true },
          { id: "B1", real_name: "Bot", is_bot: true },
          { id: "U3", real_name: "Mint" },
          { id: "U4", real_name: "Elsewhere" },
        ],
      },
    ],
  });

  assert.deepEqual(await listSlackChannelMembers("C1"), [
    { id: "U1", name: "Pack" },
    { id: "U3", name: "Mint" },
  ]);
});
