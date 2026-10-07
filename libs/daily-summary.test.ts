import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TARGET_MINUTES,
  getDaysInMonth,
  summariseMonth,
} from "./daily-summary.ts";
import type { DailyRecord } from "@/models/dashboard";

function daily(date: string, durationMinutes: number): DailyRecord {
  return {
    id: date,
    userId: "U1",
    userName: "stpack",
    startTime: "09:00",
    endTime: "09:30",
    durationMinutes,
    date,
    timezone: "Asia/Bangkok",
    submittedAt: null,
    note: null,
  };
}

test("counts the days each month actually has", () => {
  assert.equal(getDaysInMonth("2026-09"), 30);
  assert.equal(getDaysInMonth("2026-01"), 31);
  assert.equal(getDaysInMonth("2026-02"), 28);
  assert.equal(getDaysInMonth("2024-02"), 29, "leap year");
});

test("returns zero days for a month it cannot parse", () => {
  for (const bad of ["", "2026", "2026-13", "2026-00", "not-a-month"]) {
    assert.equal(getDaysInMonth(bad), 0, `${bad} should not yield a day count`);
  }
});

test("counts only the records inside the month asked for", () => {
  const records = [daily("2026-08-31", 10), daily("2026-09-01", 10), daily("2026-10-01", 10)];

  assert.equal(summariseMonth(records, "2026-09", 30).recordedDays, 1);
});

test("passes a day whose duration is at or under the target", () => {
  const records = [daily("2026-09-01", 29), daily("2026-09-02", 30), daily("2026-09-03", 31)];
  const summary = summariseMonth(records, "2026-09", 30);

  assert.equal(summary.recordedDays, 3);
  assert.equal(summary.passedDays, 2, "30 minutes meets a 30 minute target");
});

test("scores passed days against the days that have data, not the whole month", () => {
  const records = [daily("2026-09-01", 10), daily("2026-09-02", 10), daily("2026-09-03", 60)];
  const summary = summariseMonth(records, "2026-09", 30);

  assert.equal(summary.daysInMonth, 30, "still reported, for the recorded-days ratio");
  assert.equal(summary.recordedDays, 3);
  assert.equal(summary.passedDays, 2);
  assert.equal(summary.passedPercent, 67, "2 of 3 recorded days, not 2 of 30");
});

test("reaches 100% when every recorded day is inside the target", () => {
  const records = [daily("2026-09-01", 10), daily("2026-09-02", 30)];

  assert.equal(summariseMonth(records, "2026-09", 30).passedPercent, 100);
});

test("moves the pass line when the target changes", () => {
  const records = [daily("2026-09-01", 45)];

  assert.equal(summariseMonth(records, "2026-09", 30).passedDays, 0);
  assert.equal(summariseMonth(records, "2026-09", 45).passedDays, 1);
});

test("reports zeroes rather than dividing by zero", () => {
  assert.deepEqual(summariseMonth([], "2026-09", DEFAULT_TARGET_MINUTES), {
    daysInMonth: 30,
    recordedDays: 0,
    passedDays: 0,
    passedPercent: 0,
  });
  assert.equal(summariseMonth([], "nonsense", 30).passedPercent, 0);
});
