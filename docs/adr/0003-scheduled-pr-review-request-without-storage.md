---
date: 2026-10-05
status: accepted
---

# Schedule PR Review Requests through Slack, cancelled from a bot DM

On 2026-10-05 `/pr` gained a Send choice (Now / Tomorrow 09:00 / Custom). Scheduled requests go through Slack's `chat.scheduleMessage`, and nothing is written to Firestore. Cancelling needs the `scheduled_message_id`, so the bot sends the creator a DM with a Cancel button that carries that id. The DM stays put across reloads and devices, and only its creator can see it, so no separate owner check is needed.

## Considered Options

- Ephemeral confirmation in the channel: rejected because it disappears on reload, often before tomorrow's send time.
- `/pr list` built on `chat.scheduledMessages.list`: rejected because the creator could only be read back out of the message text.
- Firestore plus the dashboard: rejected because no other feature needs PR data stored.

## Consequences

- The Slack app must have the App Home **Messages Tab** enabled for the DM to reach the creator.
- "Tomorrow 09:00" is the next calendar day at 09:00 in `SLACK_TIMEZONE`, even when that day is a weekend.
- Editing a scheduled request is out of scope. The creator cancels it and submits a new one.
