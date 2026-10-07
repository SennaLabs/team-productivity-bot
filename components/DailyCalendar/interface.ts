import type { DailySummary } from "@/libs/daily-summary";
import type { DailyRecord } from "@/models/dashboard";

export interface WithDailyCalendarProps {
  channelId: string;
}

export interface DailyTimeValues {
  startTime: string;
  endTime: string;
  note?: string;
}

export interface DailyCalendarProps {
  recordsByDate: Map<string, DailyRecord>;
  summary: DailySummary;
  targetMinutes: number;
  onTargetChange: (minutes: number) => void;
  onMonthChange: (month: string) => void;
  isPending: boolean;
  error: string | null;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onSave: (values: DailyTimeValues) => void;
  onDelete: (date: string) => Promise<void>;
  isSaving: boolean;
  saveError: string | null;
}
