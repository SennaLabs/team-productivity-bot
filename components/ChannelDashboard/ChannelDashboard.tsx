"use client";

import React from "react";
import Link from "next/link";
import { Alert, Card, Empty, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DateTime } from "luxon";
import { DailyCalendar } from "@/components/DailyCalendar";
import { IssueCreateForm } from "@/components/IssueCreateForm";
import type { DashboardMember, IssueRecord } from "@/models/dashboard";

import type { ChannelDashboardProps } from "./interface";

function formatDateTime(value: string | null, timezone = "Asia/Bangkok") {
  if (!value) {
    return "-";
  }

  const date = DateTime.fromISO(value).setZone(timezone);

  return date.isValid
    ? date.setLocale("th").toFormat("dd LLL yyyy, HH:mm")
    : value;
}

function memberName(member: DashboardMember) {
  return member.userName || member.userId || "-";
}

const issueColumns: ColumnsType<IssueRecord> = [
  {
    title: "สร้างเมื่อ",
    dataIndex: "createdAt",
    key: "createdAt",
    width: 190,
    render: (value: string | null, record) =>
      formatDateTime(value, record.timezone),
  },
  {
    title: "ผู้สร้าง",
    dataIndex: "createdBy",
    key: "createdBy",
    width: 160,
    render: memberName,
  },
  {
    title: "Problem",
    dataIndex: "problem",
    key: "problem",
    render: (value: string | null) => (
      <div className="cell-wrap">{value || "-"}</div>
    ),
  },
  {
    title: "Blocking",
    dataIndex: "blocking",
    key: "blocking",
    render: (value: string | null) => (
      <div className="cell-wrap">{value || "-"}</div>
    ),
  },
  {
    title: "Ask",
    dataIndex: "askedUsers",
    key: "askedUsers",
    width: 200,
    render: (members: DashboardMember[]) => (
      <div className="member-list">
        {members.length ? (
          members.map((member, index) => (
            <Tag key={member.userId ?? index}>{memberName(member)}</Tag>
          ))
        ) : (
          <span>-</span>
        )}
      </div>
    ),
  },
  {
    title: "Need",
    dataIndex: "need",
    key: "need",
    render: (value: string | null) => (
      <div className="cell-wrap">{value || "-"}</div>
    ),
  },
  {
    title: "เวลา",
    dataIndex: "minutes",
    key: "minutes",
    width: 100,
    render: (minutes: number) => `${minutes} นาที`,
  },
  {
    title: "Note",
    dataIndex: "note",
    key: "note",
    render: (value: string | null) => (
      <div className="cell-wrap">{value || "-"}</div>
    ),
  },
];

function QueryError({ message }: { message: string }) {
  return (
    <Alert
      type="error"
      showIcon
      title="โหลดข้อมูลไม่สำเร็จ"
      description={message}
    />
  );
}

export function ChannelDashboard({
  channelId,
  channelLabel,
  channelError,
  dailyCount,
  issues,
  issuesPending,
  issuesError,
}: ChannelDashboardProps) {
  return (
    <main className="dashboard-shell">
      <Link className="back-link" href="/">
        ← กลับไปหน้ารวม Channel
      </Link>
      <header className="dashboard-header">
        <p className="dashboard-eyebrow">Channel dashboard</p>
        <h1 className="dashboard-title">#{channelLabel}</h1>
        <p className="dashboard-description">{channelId}</p>
      </header>

      {channelError ? (
        <QueryError message={channelError} />
      ) : (
        <Card className="dashboard-card">
          <Tabs
            defaultActiveKey="daily"
            items={[
              {
                key: "daily",
                label: `Daily (${dailyCount})`,
                children: <DailyCalendar channelId={channelId} />,
              },
              {
                key: "issues",
                label: `Issue (${issues.length})`,
                children: issuesError ? (
                  <QueryError message={issuesError} />
                ) : (
                  <>
                    <div className="issue-toolbar">
                      <IssueCreateForm channelId={channelId} />
                    </div>
                    <Table
                      rowKey="id"
                      columns={issueColumns}
                      dataSource={issues}
                      loading={issuesPending}
                      pagination={{ pageSize: 20, showSizeChanger: false }}
                      locale={{ emptyText: <Empty description="ยังไม่มี Issue" /> }}
                      scroll={{ x: 1600 }}
                    />
                  </>
                ),
              },
            ]}
          />
        </Card>
      )}
    </main>
  );
}
