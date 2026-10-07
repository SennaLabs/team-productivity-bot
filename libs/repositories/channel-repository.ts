import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getDatabase } from "@/libs/firebase/admin";
import { createIssueRecordData } from "@/libs/repositories/channel-records";
import type {
  ChannelSummary,
  DailyRecord,
  DashboardMember,
  IssueRecord,
} from "@/models/dashboard";
import type {
  DailySubmission,
  DailyTimeRange,
  IssueSubmission,
  SlackChannelContext,
} from "@/models/slack-api";

const CHANNELS_COLLECTION = "slackChannels";
const DASHBOARD_PAGE_SIZE = 100;

function getChannelDocument(channelId: string) {
  return getDatabase().collection(CHANNELS_COLLECTION).doc(channelId);
}

function channelData(context: SlackChannelContext) {
  return {
    channelId: context.channelId,
    channelName: context.channelName,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function toIsoString(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function toNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function toMember(value: unknown): DashboardMember {
  if (!value || typeof value !== "object") {
    return { userId: null, userName: null };
  }

  const member = value as Record<string, unknown>;

  return {
    userId: toNullableString(member.userId),
    userName: toNullableString(member.userName),
  };
}

export async function listChannels(): Promise<ChannelSummary[]> {
  const snapshot = await getDatabase()
    .collection(CHANNELS_COLLECTION)
    .orderBy("updatedAt", "desc")
    .limit(DASHBOARD_PAGE_SIZE)
    .get();

  return snapshot.docs.map((document) => {
    const data = document.data();

    return {
      channelId: toString(data.channelId, document.id),
      channelName: toNullableString(data.channelName),
      updatedAt: toIsoString(data.updatedAt),
    };
  });
}

export async function getChannel(
  channelId: string,
): Promise<ChannelSummary | null> {
  const snapshot = await getChannelDocument(channelId).get();

  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data() ?? {};

  return {
    channelId: toString(data.channelId, snapshot.id),
    channelName: toNullableString(data.channelName),
    updatedAt: toIsoString(data.updatedAt),
  };
}

export async function listDailySubmissions(
  channelId: string,
): Promise<DailyRecord[]> {
  const snapshot = await getChannelDocument(channelId)
    .collection("dailySubmissions")
    .orderBy("date", "desc")
    .limit(DASHBOARD_PAGE_SIZE)
    .get();

  return snapshot.docs.map((document) => {
    const data = document.data();

    return {
      id: document.id,
      userId: toNullableString(data.userId),
      userName: toNullableString(data.userName),
      startTime: toString(data.startTime),
      endTime: toString(data.endTime),
      durationMinutes: toNumber(data.durationMinutes),
      date: toString(data.date, document.id),
      timezone: toString(data.timezone, "Asia/Bangkok"),
      submittedAt: toIsoString(data.submittedAt),
      note: toNullableString(data.note),
    };
  });
}

export async function listIssueSubmissions(
  channelId: string,
): Promise<IssueRecord[]> {
  const snapshot = await getChannelDocument(channelId)
    .collection("issueSubmissions")
    .orderBy("createdAt", "desc")
    .limit(DASHBOARD_PAGE_SIZE)
    .get();

  return snapshot.docs.map((document) => {
    const data = document.data();
    const legacyUserIds = Array.isArray(data.askUserIds)
      ? data.askUserIds
      : [];
    const legacyUserNames = Array.isArray(data.askUserNames)
      ? data.askUserNames
      : [];
    const askedUsers = Array.isArray(data.askedUsers)
      ? data.askedUsers.map(toMember)
      : legacyUserIds.map((userId, index) => ({
          userId: toNullableString(userId),
          userName: toNullableString(legacyUserNames[index]),
        }));

    return {
      id: document.id,
      createdBy: data.createdBy
        ? toMember(data.createdBy)
        : {
            userId: toNullableString(data.userId),
            userName: toNullableString(data.userName),
          },
      askedUsers,
      problem: toNullableString(data.problem),
      blocking: toNullableString(data.blocking),
      need: toNullableString(data.need),
      minutes: toNumber(data.minutes),
      note: toNullableString(data.note),
      createdDate: toNullableString(data.createdDate),
      timezone: toString(data.timezone, "Asia/Bangkok"),
      createdAt: toIsoString(data.createdAt),
    };
  });
}

export async function getChannelDailyTimeRange(channelId: string) {
  const snapshot = await getChannelDocument(channelId).get();

  return snapshot.get("dailyTimeRange") as DailyTimeRange | undefined;
}

export async function setChannelDailyTimeRange(
  context: SlackChannelContext,
  timeRange: DailyTimeRange,
) {
  if (!context.channelId) {
    throw new Error("Channel ID is required");
  }

  await getChannelDocument(context.channelId).set(
    {
      ...channelData(context),
      dailyTimeRange: timeRange,
    },
    { merge: true },
  );
}

export async function saveDailySubmission(submission: DailySubmission) {
  const channelId = submission.channel.channelId;

  if (!channelId) {
    throw new Error("Channel ID is required");
  }

  const channel = getChannelDocument(channelId);
  const record = channel.collection("dailySubmissions").doc(submission.date);
  const batch = getDatabase().batch();
  const recordData = {
    userId: submission.userId ?? null,
    userName: submission.userName ?? null,
    startTime: submission.startTime,
    endTime: submission.endTime,
    durationMinutes: submission.durationMinutes,
    date: submission.date,
    timezone: submission.timezone,
    // Written even when empty so a resubmission clears the date's previous note.
    note: submission.note ?? null,
  };

  batch.set(channel, channelData(submission.channel), { merge: true });
  batch.set(
    record,
    {
      ...recordData,
      submittedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit();
}

// Dashboard edits only touch the time and note fields so the Slack submitter stays
// on the record; a date entered from the dashboard is attributed to the session user.
export async function saveDashboardDailyTime(
  channelId: string,
  date: string,
  time: Pick<DailyRecord, "startTime" | "endTime" | "durationMinutes" | "note">,
  editorName: string,
) {
  const record = getChannelDocument(channelId)
    .collection("dailySubmissions")
    .doc(date);

  await getDatabase().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(record);

    transaction.set(
      record,
      snapshot.exists
        ? time
        : {
            ...time,
            userId: null,
            userName: editorName,
            date,
            timezone: process.env.SLACK_TIMEZONE ?? "Asia/Bangkok",
            submittedAt: FieldValue.serverTimestamp(),
          },
      { merge: true },
    );
  });
}

export async function deleteDailySubmission(channelId: string, date: string) {
  await getChannelDocument(channelId)
    .collection("dailySubmissions")
    .doc(date)
    .delete();
}

// Firestore mints document ids locally, so the Slack message can carry the row id
// in its Delete button without waiting for the write to land.
export function newIssueSubmissionId(channelId: string) {
  return getChannelDocument(channelId).collection("issueSubmissions").doc().id;
}

export async function deleteIssueSubmission(
  channelId: string,
  issueId: string,
) {
  await getChannelDocument(channelId)
    .collection("issueSubmissions")
    .doc(issueId)
    .delete();
}

export async function saveIssueSubmission(
  submission: IssueSubmission,
  issueId: string,
) {
  const channelId = submission.channel.channelId;

  if (!channelId) {
    throw new Error("Channel ID is required");
  }

  const channel = getChannelDocument(channelId);
  const record = channel.collection("issueSubmissions").doc(issueId);
  const batch = getDatabase().batch();
  const recordData = createIssueRecordData(submission);

  batch.set(channel, channelData(submission.channel), { merge: true });
  batch.set(record, {
    ...recordData,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
}
