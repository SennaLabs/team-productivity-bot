export type ChannelSummary = {
  channelId: string;
  channelName: string | null;
  updatedAt: string | null;
};

export type DailyRecord = {
  id: string;
  userId: string | null;
  userName: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  date: string;
  timezone: string;
  submittedAt: string | null;
  note: string | null;
};

export type DashboardMember = {
  userId: string | null;
  userName: string | null;
};

export type ChannelMember = {
  userId: string;
  userName: string;
  active: boolean;
};

export type NewIssueValues = {
  problem: string;
  blocking: string;
  askUserIds: string[];
  need: string;
  minutes: number;
  note?: string;
};

export type IssueRecord = {
  id: string;
  createdBy: DashboardMember;
  askedUsers: DashboardMember[];
  problem: string | null;
  blocking: string | null;
  need: string | null;
  minutes: number;
  note: string | null;
  createdDate: string | null;
  timezone: string;
  createdAt: string | null;
};
