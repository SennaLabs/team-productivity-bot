"use client";

import React from "react";
import { Alert, Button, Form, Input, InputNumber, Modal, Select } from "antd";

import type { IssueCreateFormProps } from "./interface";

const textArea = { autoSize: { minRows: 2, maxRows: 6 } };

export function IssueCreateForm({
  open,
  onOpenChange,
  members,
  membersPending,
  onSyncMembers,
  isSyncing,
  syncError,
  onSubmit,
  isSaving,
  saveError,
}: IssueCreateFormProps) {
  return (
    <>
      <Button type="primary" onClick={() => onOpenChange(true)}>
        สร้าง Issue
      </Button>
      <Modal
        open={open}
        title="สร้าง Issue"
        okText="บันทึก"
        cancelText="ยกเลิก"
        // The OK button renders outside the form, so it submits through the form attribute.
        okButtonProps={{ htmlType: "submit", form: "issue-create-form" }}
        confirmLoading={isSaving}
        onCancel={() => onOpenChange(false)}
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
        <Form id="issue-create-form" layout="vertical" onFinish={onSubmit}>
          <Form.Item
            name="problem"
            label="Problem"
            rules={[{ required: true, whitespace: true, message: "กรุณาระบุ Problem" }]}
          >
            <Input placeholder="ติดอะไร" />
          </Form.Item>
          <Form.Item
            name="blocking"
            label="Blocking"
            rules={[{ required: true, whitespace: true, message: "กรุณาระบุ Blocking" }]}
          >
            <Input.TextArea {...textArea} placeholder="ใครรอ ทำอะไรต่อไม่ได้" />
          </Form.Item>
          <Form.Item
            name="askUserIds"
            label="Ask"
            rules={[{ required: true, message: "กรุณาเลือกคนที่ขอให้ช่วย" }]}
            extra={
              <Button
                type="link"
                size="small"
                style={{ paddingInline: 0 }}
                loading={isSyncing}
                onClick={onSyncMembers}
              >
                Sync members จาก Slack
              </Button>
            }
          >
            <Select
              mode="multiple"
              placeholder="ขอใครช่วย"
              loading={membersPending}
              showSearch={{ optionFilterProp: "label" }}
              options={members.map((member) => ({
                value: member.userId,
                label: member.userName,
              }))}
              notFoundContent="ไม่พบรายชื่อ กด Sync members จาก Slack"
            />
          </Form.Item>
          {syncError && (
            <Alert
              type="error"
              showIcon
              title={syncError}
              style={{ marginBottom: 16 }}
            />
          )}
          <Form.Item
            name="need"
            label="Need"
            rules={[{ required: true, whitespace: true, message: "กรุณาระบุ Need" }]}
          >
            <Input.TextArea {...textArea} placeholder="อยากได้อะไรกลับมา" />
          </Form.Item>
          <Form.Item
            name="minutes"
            label="Time"
            rules={[{ required: true, message: "กรุณาระบุจำนวนนาที" }]}
          >
            <InputNumber
              min={1}
              precision={0}
              suffix="นาที"
              placeholder="คุยกี่นาที เช่น 15"
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item name="note" label="Note">
            <Input.TextArea {...textArea} placeholder="ข้อมูลเพิ่ม" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
