"use client";

import React from "react";
import {
  Alert,
  App,
  Button,
  Calendar,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Spin,
  Statistic,
} from "antd";

import type { DailyCalendarProps } from "./interface";

export function DailyCalendar({
  recordsByDate,
  summary,
  targetMinutes,
  onTargetChange,
  onMonthChange,
  isPending,
  error,
  selectedDate,
  onSelectDate,
  onSave,
  isSaving,
  saveError,
  onDelete,
}: DailyCalendarProps) {
  const { modal, message } = App.useApp();

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        title="โหลดข้อมูลไม่สำเร็จ"
        description={error}
      />
    );
  }

  const selectedRecord = selectedDate
    ? recordsByDate.get(selectedDate)
    : undefined;

  return (
    <Spin spinning={isPending}>
      <div className="daily-summary">
        <div className="daily-summary-target">
          <span className="daily-summary-label">Target ต่อวัน</span>
          <InputNumber
            min={1}
            max={480}
            step={5}
            value={targetMinutes}
            onChange={(value) => onTargetChange(value ?? 0)}
            suffix="นาที"
          />
        </div>
        <Statistic
          title="วันที่บันทึก"
          value={summary.recordedDays}
          suffix={`/ ${summary.daysInMonth} วัน`}
        />
        <Statistic
          title={`วันที่ผ่าน (ไม่เกิน ${targetMinutes} นาที)`}
          value={summary.passedDays}
          suffix={`วัน · ${summary.passedPercent}% ของวันที่บันทึก`}
        />
      </div>

      <Calendar
        className="daily-calendar"
        onPanelChange={(date) => onMonthChange(date.format("YYYY-MM"))}
        cellRender={(date, info) => {
          if (info.type !== "date") {
            return null;
          }

          const dateKey = date.format("YYYY-MM-DD");
          const record = recordsByDate.get(dateKey);
          const passed = record && record.durationMinutes <= targetMinutes;

          return (
            <>
              {record && (
                <div
                  className={`daily-cell${passed ? "" : " daily-cell-over"}`}
                >
                  <span className="daily-cell-time">
                    {record.startTime}–{record.endTime}
                  </span>
                  <span className="daily-cell-meta">
                    {record.durationMinutes} นาที ·{" "}
                    {record.userName || record.userId || "-"}
                  </span>
                  {record.note && (
                    <span className="daily-cell-meta" title={record.note}>
                      {record.note}
                    </span>
                  )}
                </div>
              )}
              {/* Clicking a date in the neighbouring month switches the panel, and
                  menu clicks bubble here through the portal, so both stop at this span. */}
              <div
                className="daily-cell-actions"
                onClick={(event) => event.stopPropagation()}
              >
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      { key: "create", label: "เพิ่ม", disabled: !!record },
                      { key: "edit", label: "แก้ไข", disabled: !record },
                      {
                        key: "delete",
                        label: "ลบ",
                        danger: true,
                        disabled: !record,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (key !== "delete") {
                        onSelectDate(dateKey);
                        return;
                      }

                      modal.confirm({
                        title: `ลบ Daily ${dateKey}?`,
                        okText: "ลบ",
                        okButtonProps: { danger: true },
                        cancelText: "ยกเลิก",
                        onOk: () =>
                          onDelete(dateKey).catch((deleteError: Error) =>
                            message.error(deleteError.message),
                          ),
                      });
                    },
                  }}
                >
                  <Button size="small" type="text" aria-label="การทำงาน">
                    ⋯
                  </Button>
                </Dropdown>
              </div>
            </>
          );
        }}
      />

      <Modal
        open={selectedDate !== null}
        title={`${selectedRecord ? "แก้ไข" : "เพิ่ม"} Daily ${selectedDate ?? ""}`}
        okText="บันทึก"
        cancelText="ยกเลิก"
        // The OK button renders outside the form, so it submits through the form attribute.
        okButtonProps={{ htmlType: "submit", form: "daily-time-form" }}
        confirmLoading={isSaving}
        onCancel={() => onSelectDate(null)}
        destroyOnHidden
      >
        {saveError && (
          <Alert
            type="error"
            showIcon
            title={saveError}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          id="daily-time-form"
          layout="vertical"
          initialValues={
            selectedRecord && {
              startTime: selectedRecord.startTime,
              endTime: selectedRecord.endTime,
              note: selectedRecord.note ?? undefined,
            }
          }
          onFinish={onSave}
        >
          <Form.Item
            name="startTime"
            label="เวลาเริ่ม"
            rules={[{ required: true, message: "กรุณาระบุเวลาเริ่ม" }]}
          >
            <Input type="time" />
          </Form.Item>
          <Form.Item
            name="endTime"
            label="เวลาสิ้นสุด"
            dependencies={["startTime"]}
            rules={[
              { required: true, message: "กรุณาระบุเวลาสิ้นสุด" },
              ({ getFieldValue }) => ({
                validator(_, value: string | undefined) {
                  const startTime: string | undefined =
                    getFieldValue("startTime");

                  // HH:mm strings sort the same as the times they hold.
                  return !value || !startTime || value > startTime
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น"),
                      );
                },
              }),
            ]}
          >
            <Input type="time" />
          </Form.Item>
          <Form.Item name="note" label="Note">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder="ข้อมูลเพิ่ม"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
}
