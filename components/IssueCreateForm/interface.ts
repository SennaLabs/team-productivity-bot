import type { ChannelMember, NewIssueValues } from "@/models/dashboard";

export interface WithIssueCreateFormProps {
  channelId: string;
}

export interface IssueCreateFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: ChannelMember[];
  membersPending: boolean;
  onSyncMembers: () => void;
  isSyncing: boolean;
  syncError: string | null;
  onSubmit: (values: NewIssueValues) => void;
  isSaving: boolean;
  saveError: string | null;
}
