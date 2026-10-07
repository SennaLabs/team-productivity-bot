import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  SlackChannelContext,
  SlackCommand,
  SlackInputValue,
  SlackInteractionPayload,
  SlackModalMetadata,
} from "@/models/slack-api";

export function parseSlackCommand(formData: FormData): SlackCommand | null {
  const triggerId = formData.get("trigger_id");

  if (typeof triggerId !== "string" || !triggerId) {
    return null;
  }

  const channelId = formData.get("channel_id");
  const channelName = formData.get("channel_name");
  const requesterUserId = formData.get("user_id");
  const requesterUserName = formData.get("user_name");

  return {
    triggerId,
    metadata: {
      channel: {
        channelId: typeof channelId === "string" ? channelId : null,
        channelName: typeof channelName === "string" ? channelName : null,
      },
      requesterUserId:
        typeof requesterUserId === "string" ? requesterUserId : null,
      requesterUserName:
        typeof requesterUserName === "string" ? requesterUserName : null,
    },
  };
}

export function isValidSlackRequest(request: Request, rawBody: string) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  if (!signingSecret || !timestamp || !signature) {
    return false;
  }

  const timestampSeconds = Number(timestamp);

  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > 60 * 5
  ) {
    return false;
  }

  const expectedSignature = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function parseInteractionPayload(rawBody: string) {
  const encodedPayload = new URLSearchParams(rawBody).get("payload");

  if (!encodedPayload) {
    return null;
  }

  try {
    return JSON.parse(encodedPayload) as SlackInteractionPayload;
  } catch {
    return null;
  }
}

export function getInput(
  payload: SlackInteractionPayload,
  blockId: string,
  actionId: string,
): SlackInputValue | undefined {
  return payload.view?.state?.values?.[blockId]?.[actionId];
}

export function getChannelContext(
  payload: SlackInteractionPayload,
): SlackChannelContext {
  try {
    const metadata = JSON.parse(
      payload.view?.private_metadata ?? "{}",
    ) as Partial<SlackModalMetadata & SlackChannelContext>;
    const context = metadata.channel ?? metadata;

    return {
      channelId:
        typeof context.channelId === "string" ? context.channelId : null,
      channelName:
        typeof context.channelName === "string" ? context.channelName : null,
    };
  } catch {
    return { channelId: null, channelName: null };
  }
}

export function getRequesterUserId(payload: SlackInteractionPayload) {
  try {
    const metadata = JSON.parse(
      payload.view?.private_metadata ?? "{}",
    ) as Partial<SlackModalMetadata>;

    return typeof metadata.requesterUserId === "string"
      ? metadata.requesterUserId
      : null;
  } catch {
    return null;
  }
}

export function getRequesterUserName(payload: SlackInteractionPayload) {
  try {
    const metadata = JSON.parse(
      payload.view?.private_metadata ?? "{}",
    ) as Partial<SlackModalMetadata>;

    return typeof metadata.requesterUserName === "string"
      ? metadata.requesterUserName
      : null;
  } catch {
    return null;
  }
}

export function getThreadTs(payload: SlackInteractionPayload) {
  try {
    const metadata = JSON.parse(
      payload.view?.private_metadata ?? "{}",
    ) as Partial<SlackModalMetadata>;

    return typeof metadata.threadTs === "string" ? metadata.threadTs : undefined;
  } catch {
    return undefined;
  }
}

export function getMinutesSinceMidnight(time: string) {
  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
}

export function parsePositiveInteger(value: string | undefined) {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !/^[1-9]\d*$/.test(normalizedValue)) {
    return null;
  }

  const number = Number(normalizedValue);

  return Number.isSafeInteger(number) ? number : null;
}

function formatDateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export function getCalendarDate(
  timezone: string | undefined,
  date = new Date(),
) {
  const fallbackTimezone = process.env.SLACK_TIMEZONE ?? "Asia/Bangkok";

  try {
    const resolvedTimezone = timezone || fallbackTimezone;

    return {
      date: formatDateInTimezone(date, resolvedTimezone),
      timezone: resolvedTimezone,
    };
  } catch {
    return {
      date: formatDateInTimezone(date, fallbackTimezone),
      timezone: fallbackTimezone,
    };
  }
}

function getWallClockMs(date: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );

  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function getTomorrowAtNine(now: Date, timezone: string) {
  const [year, month, day] = formatDateInTimezone(now, timezone)
    .split("-")
    .map(Number);
  const wallClock = Date.UTC(year, month - 1, day + 1, 9);
  // ponytail: one offset lookup, an hour off only if a DST switch falls between
  // midnight and 09:00 — re-check the offset at the result if a DST zone is used.
  const offset = getWallClockMs(new Date(wallClock), timezone) - wallClock;

  return Math.floor((wallClock - offset) / 1000);
}

// Slack refuses post_at in the past or beyond 120 days; the one-minute floor keeps a
// pick that is "now" by the time it reaches Slack from failing after the modal closed.
const MIN_SCHEDULE_SECONDS = 60;
const MAX_SCHEDULE_SECONDS = 120 * 24 * 60 * 60;

export function resolvePrPostAt(
  send: string | undefined,
  customSeconds: number | undefined,
  now = new Date(),
  timezone = getCalendarDate(undefined).timezone,
): { postAt: number | null } | { error: string } {
  if (send === "tomorrow") {
    return { postAt: getTomorrowAtNine(now, timezone) };
  }

  if (send !== "custom") {
    return { postAt: null };
  }

  if (customSeconds === undefined) {
    return { error: "เลือกวันและเวลาที่จะส่ง" };
  }

  const secondsAhead = customSeconds - now.getTime() / 1000;

  if (secondsAhead < MIN_SCHEDULE_SECONDS) {
    return { error: "เวลาต้องอยู่ในอนาคตอย่างน้อย 1 นาที" };
  }

  if (secondsAhead > MAX_SCHEDULE_SECONDS) {
    return { error: "ตั้งเวลาได้ไม่เกิน 120 วัน" };
  }

  return { postAt: customSeconds };
}

export function parsePrUrl(value: string | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);

    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function splitTicketLinks(value: string | undefined) {
  return (
    value
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? []
  );
}
