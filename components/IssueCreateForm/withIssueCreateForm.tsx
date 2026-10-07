"use client";

import type { FC } from "react";
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createIssueRecord,
  getChannelMembers,
  syncChannelMembers,
} from "@/libs/api/dashboard";
import type { NewIssueValues } from "@/models/dashboard";
import type {
  IssueCreateFormProps,
  WithIssueCreateFormProps,
} from "./interface";

export function withIssueCreateForm(Component: FC<IssueCreateFormProps>) {
  function WithIssueCreateForm({ channelId }: WithIssueCreateFormProps) {
    const [open, setOpen] = useState(false);
    const queryClient = useQueryClient();
    const membersQuery = useQuery({
      queryKey: ["members", channelId],
      queryFn: () => getChannelMembers(channelId),
      enabled: open,
    });
    const {
      mutate: syncMembers,
      reset: resetSync,
      isPending: isSyncing,
      error: syncError,
    } = useMutation({
      mutationFn: () => syncChannelMembers(channelId),
      // The issue list fills missing Ask names from the members, so it refreshes too.
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ["members", channelId] }),
          queryClient.invalidateQueries({ queryKey: ["issues", channelId] }),
        ]),
    });
    const {
      mutate: createIssue,
      reset: resetCreate,
      isPending: isSaving,
      error: saveError,
    } = useMutation({
      mutationFn: (values: NewIssueValues) =>
        createIssueRecord(channelId, values),
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: ["issues", channelId] });
        setOpen(false);
      },
    });
    const onOpenChange = useCallback(
      (nextOpen: boolean) => {
        resetSync();
        resetCreate();
        setOpen(nextOpen);
      },
      [resetSync, resetCreate],
    );
    const onSyncMembers = useCallback(() => syncMembers(), [syncMembers]);

    return (
      <Component
        open={open}
        onOpenChange={onOpenChange}
        members={membersQuery.data ?? []}
        membersPending={membersQuery.isFetching}
        onSyncMembers={onSyncMembers}
        isSyncing={isSyncing}
        syncError={syncError?.message ?? membersQuery.error?.message ?? null}
        onSubmit={createIssue}
        isSaving={isSaving}
        saveError={saveError?.message ?? null}
      />
    );
  }

  return WithIssueCreateForm;
}
