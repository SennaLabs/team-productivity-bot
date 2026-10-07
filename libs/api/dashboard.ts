import type {
  ChannelSummary,
  DailyRecord,
  IssueRecord,
} from "@/models/dashboard";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (response.status === 401 && typeof window !== "undefined") {
    const next = `${window.location.pathname}${window.location.search}`;
    const loginUrl = new URL("/login", window.location.origin);
    loginUrl.searchParams.set("next", next);
    window.location.assign(loginUrl.toString());
    throw new Error("Session expired");
  }

  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    throw new Error(result?.error ?? "Unable to load data");
  }

  return (response.status === 204 ? undefined : response.json()) as Promise<T>;
}

export async function getChannels() {
  const result = await requestJson<{ channels: ChannelSummary[] }>("/api/channels");

  return result.channels;
}

export async function getChannel(channelId: string) {
  const result = await requestJson<{ channel: ChannelSummary }>(
    `/api/channels/${encodeURIComponent(channelId)}`,
  );

  return result.channel;
}

export async function getDailyRecords(channelId: string) {
  const result = await requestJson<{ daily: DailyRecord[] }>(
    `/api/channels/${encodeURIComponent(channelId)}/daily`,
  );

  return result.daily;
}

export async function saveDailyRecord(
  channelId: string,
  date: string,
  time: { startTime: string; endTime: string; note?: string },
) {
  await requestJson<void>(
    `/api/channels/${encodeURIComponent(channelId)}/daily/${encodeURIComponent(date)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(time),
    },
  );
}

export async function deleteDailyRecord(channelId: string, date: string) {
  await requestJson<void>(
    `/api/channels/${encodeURIComponent(channelId)}/daily/${encodeURIComponent(date)}`,
    { method: "DELETE" },
  );
}

export async function getIssueRecords(channelId: string) {
  const result = await requestJson<{ issues: IssueRecord[] }>(
    `/api/channels/${encodeURIComponent(channelId)}/issues`,
  );

  return result.issues;
}
