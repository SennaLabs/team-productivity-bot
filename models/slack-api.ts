export type PrPriority = "normal" | "attention" | "urgent" | "critical";

export type SlackChannelContext = {
  channelId: string | null;
  channelName: string | null;
};

export type SlackCommand = {
  triggerId: string;
  metadata: SlackModalMetadata;
};

export type SlackModalMetadata = {
  channel: SlackChannelContext;
  requesterUserId: string | null;
  requesterUserName: string | null;
};

export type SlackModal = Record<string, unknown>;

export type SlackBlock = Record<string, unknown>;

export type SlackInputValue = {
  value?: string;
  selected_option?: {
    value?: string;
  };
  selected_time?: string;
  selected_date_time?: number;
  selected_users?: string[];
  timezone?: string;
};

export type SlackInteractionPayload = {
  type: string;
  user?: {
    id?: string;
    name?: string;
    username?: string;
  };
  channel?: {
    id?: string;
    name?: string;
  };
  message?: {
    ts?: string;
    thread_ts?: string;
    text?: string;
    blocks?: SlackBlock[];
  };
  actions?: {
    action_id?: string;
    value?: string;
    selected_option?: {
      value?: string;
    };
  }[];
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, SlackInputValue>>;
    };
  };
};

export type SlackMember = {
  id: string;
  name: string;
};

export type DailySubmission = {
  channel: SlackChannelContext;
  userId?: string;
  userName?: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  date: string;
  timezone: string;
};

export type DailyTimeRange = {
  startTime: string;
  endTime: string;
};

export type IssueSubmission = {
  channel: SlackChannelContext;
  userId?: string;
  userName?: string;
  problem?: string;
  blocking?: string;
  askUserIds: string[];
  askUserNames?: string[];
  need?: string;
  minutes: number;
  note?: string;
  createdDate: string;
  timezone: string;
};

export type SlackApiResponse = {
  ok: boolean;
  error?: string;
  needed?: string;
  provided?: string;
};

export type SlackUserInfoResponse = SlackApiResponse & {
  user?: {
    id?: string;
    real_name?: string;
    name?: string;
    profile?: {
      display_name?: string;
      real_name?: string;
    };
  };
};

export type PrSubmission = {
  channel: SlackChannelContext;
  userId?: string;
  userName?: string;
  ticketLinks: string[];
  prUrl: string;
  priority: PrPriority;
  reviewerUserIds: string[];
  watcherUserIds: string[];
};
