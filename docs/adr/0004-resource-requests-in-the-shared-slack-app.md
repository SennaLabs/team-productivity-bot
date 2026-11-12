---
date: 2026-11-12
status: accepted
---

# Resource requests live in this app, routed by an ID prefix

PMs and Sales borrow a named person from the PM who looks after them through `/request-resource`. The feature was first built as a separate Bolt app. It moved here so it shares this Slack app, its Vercel deployment and its Firebase project instead of running beside them.

A Slack app has one Interactivity URL, so the feature's buttons and modals arrive at `/api/slack/interactions` with everything else. Every Slack ID it owns starts with `resource_request_`, and `handleSlackInteraction` passes those payloads to `libs/resource-request/interactions.ts` before its own routing. Its own two slash commands have their own routes.

Requests are kept in the top-level `resourceRequests` collection, one document per request ID. Decisions, edits and cancellations are read-check-write steps inside a Firestore transaction, so two PMs clicking at once on different instances cannot both decide.

## Considered Options

- A separate Slack app and deployment: rejected because it doubles the Slack apps, tokens and deployments people have to manage.
- Forwarding payloads over HTTP to a separate deployment: rejected because it adds a hop inside Slack's 3-second window and a second deployment to keep in sync.
- Storing requests under `slackChannels/{channelId}`: rejected because a request belongs to the people involved, and `/borrowed` reads across every channel.
- A running request number: rejected because it needs a counter document every create contends on. Requests use short random IDs such as `RR-7F3K9Q`, retried on the rare collision.

## Consequences

- New Slack IDs elsewhere in this app must not start with `resource_request_`.
- Buttons and the "⋯" menu read the request before showing their modal, so they open a loading modal first and replace it once the read finishes; the trigger_id would otherwise expire on a cold start.
- Mandays may not exceed the Mon–Fri working days in the range. Public holidays are not known.
- Amounts are entered in minutes, hours or mandays in 15-minute steps, but stored as mandays (1 manday = 8 hours). 15 minutes is 1/32 of a manday, which a float holds exactly, so totals in `/borrowed` add up without rounding.
- An optional daily time window (`startTime`/`endTime`, HH:MM wall-clock time) applies to every day of the range and caps the amount at the window per working day, at most one manday. Two requests overlap only if their dates and windows both overlap; a request without a window meets every window. Requests saved before the window existed read as having none.
- `/borrowed` filters on `endDate` only, which needs no composite index.
