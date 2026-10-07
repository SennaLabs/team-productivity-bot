import type {
  DailyTimeRange,
  SlackModal,
  SlackModalMetadata,
} from "@/models/slack-api";
import {
  DEFAULT_PR_PRIORITY,
  MAX_MERGE_NOTIFY_MINUTES,
  MAX_WATCHER_COUNT,
  MAX_WATCHER_NOTE_LENGTH,
  PR_PRIORITIES,
} from "@/libs/messages";

function priorityOption(priority: (typeof PR_PRIORITIES)[number]) {
  return {
    text: {
      type: "mrkdwn",
      text: `${priority.emoji} *${priority.label}* · ${priority.sla} ${priority.note} `,
    },
    value: priority.value,
  };
}

export function createIssueModal(metadata: SlackModalMetadata): SlackModal {
  return {
    type: "modal",
    callback_id: "issue_create",
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: "Create Issue Log" },
    submit: { type: "plain_text", text: "ส่ง" },
    close: { type: "plain_text", text: "ยกเลิก" },
    blocks: [
      {
        type: "input",
        block_id: "problem",
        label: { type: "plain_text", text: "Problem" },
        element: {
          type: "plain_text_input",
          action_id: "problem_input",
          placeholder: { type: "plain_text", text: "ติดอะไร" },
        },
      },
      {
        type: "input",
        block_id: "blocking",
        label: { type: "plain_text", text: "Blocking" },
        element: {
          type: "plain_text_input",
          action_id: "blocking_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "ใครรอ ทำอะไรต่อไม่ได้",
          },
        },
      },
      {
        type: "input",
        block_id: "ask",
        label: { type: "plain_text", text: "Ask" },
        element: {
          type: "multi_users_select",
          action_id: "ask_select",
          placeholder: { type: "plain_text", text: "ขอใครช่วย" },
        },
      },
      {
        type: "input",
        block_id: "need",
        label: { type: "plain_text", text: "Need" },
        element: {
          type: "plain_text_input",
          action_id: "need_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "อยากได้อะไรกลับมา" },
        },
      },
      {
        type: "input",
        block_id: "time",
        label: { type: "plain_text", text: "Time" },
        element: {
          type: "plain_text_input",
          action_id: "time_input",
          min_length: 1,
          placeholder: { type: "plain_text", text: "คุยกี่นาที เช่น 15" },
        },
      },
      {
        type: "input",
        block_id: "note",
        optional: true,
        label: { type: "plain_text", text: "Note" },
        element: {
          type: "plain_text_input",
          action_id: "note_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "ข้อมูลเพิ่ม" },
        },
      },
    ],
  };
}

export function createDailyModal(
  metadata: SlackModalMetadata,
  timeRange: DailyTimeRange,
): SlackModal {
  return {
    type: "modal",
    callback_id: "daily_create",
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: "Daily Meeting Time" },
    submit: { type: "plain_text", text: "ส่ง" },
    close: { type: "plain_text", text: "ยกเลิก" },
    blocks: [
      {
        type: "input",
        block_id: "start_time",
        label: { type: "plain_text", text: "เวลาเริ่มต้น" },
        hint: {
          type: "plain_text",
          text: "ระบุเวลาได้ละเอียดเป็นนาที เช่น 09:00",
        },
        element: {
          type: "timepicker",
          action_id: "start_time_input",
          initial_time: timeRange.startTime,
          placeholder: { type: "plain_text", text: "เช่น 09:00" },
        },
      },
      {
        type: "input",
        block_id: "end_time",
        label: { type: "plain_text", text: "เวลาสิ้นสุด" },
        hint: {
          type: "plain_text",
          text: "ระบุเวลาได้ละเอียดเป็นนาที เช่น 09:34",
        },
        element: {
          type: "timepicker",
          action_id: "end_time_input",
          initial_time: timeRange.endTime,
          placeholder: { type: "plain_text", text: "เช่น 09:34" },
        },
      },
      {
        type: "input",
        block_id: "note",
        optional: true,
        label: { type: "plain_text", text: "Note" },
        element: {
          type: "plain_text_input",
          action_id: "note_input",
          multiline: true,
          // The note shares one 300-character section block with the times in
          // the channel post, so Slack's own 300 limit would let the post fail.
          max_length: 300,
          placeholder: { type: "plain_text", text: "ข้อมูลเพิ่ม" },
        },
      },
    ],
  };
}

const SEND_OPTIONS = [
  { value: "now", text: "Now" },
  { value: "tomorrow", text: "Tomorrow 09:00" },
  { value: "custom", text: "Custom" },
].map(({ value, text }) => ({ value, text: { type: "plain_text", text } }));

const MORE_OPTIONS = {
  value: "more",
  text: { type: "plain_text", text: "ตั้งค่าเพิ่มเติม" },
  description: {
    type: "plain_text",
    text: "แจ้ง Watcher หลัง merge, ข้อความ, เวลาส่ง",
  },
};

const MORE_OPTION_BLOCKS = [
  {
    type: "input",
    block_id: "merge_notify",
    label: { type: "plain_text", text: "แจ้ง Watcher หลัง merge (นาที)" },
    hint: {
      type: "plain_text",
      text: `0 = ทันที, สูงสุด ${MAX_MERGE_NOTIFY_MINUTES} นาที`,
    },
    element: {
      type: "number_input",
      action_id: "merge_notify_input",
      is_decimal_allowed: false,
      min_value: "0",
      max_value: String(MAX_MERGE_NOTIFY_MINUTES),
      initial_value: "0",
    },
  },
  {
    type: "input",
    block_id: "watcher_note",
    optional: true,
    label: { type: "plain_text", text: "ข้อความถึง Watcher" },
    element: {
      type: "plain_text_input",
      action_id: "watcher_note_input",
      multiline: true,
      max_length: MAX_WATCHER_NOTE_LENGTH,
      placeholder: {
        type: "plain_text",
        text: "เช่น deploy staging แล้ว ทดสอบได้เลย",
      },
    },
  },
  {
    type: "input",
    block_id: "send_at",
    label: { type: "plain_text", text: "Send" },
    element: {
      type: "radio_buttons",
      action_id: "send_at_select",
      initial_option: SEND_OPTIONS[0],
      options: SEND_OPTIONS,
    },
  },
  {
    type: "input",
    block_id: "send_custom",
    optional: true,
    label: { type: "plain_text", text: "Custom time" },
    // Slack cannot show this only when Custom is picked without a views.update
    // round-trip per click, so it always shows and is read only for Custom.
    hint: { type: "plain_text", text: "ใช้เมื่อเลือก Custom" },
    element: {
      type: "datetimepicker",
      action_id: "send_custom_input",
    },
  },
];

// Slack modals have no collapsible block, so the checkbox re-renders the view with
// views.update. Slack keeps what was typed into blocks whose block_id survives the
// update, but blocks that are hidden submit nothing, so a collapsed modal posts now
// and tells watchers the moment the PR is merged, with no note.
export function createPrModal(
  metadata: SlackModalMetadata,
  showMoreOptions = false,
): SlackModal {
  return {
    type: "modal",
    callback_id: "pr_create",
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: "Request PR Review" },
    submit: { type: "plain_text", text: "ส่ง" },
    close: { type: "plain_text", text: "ยกเลิก" },
    blocks: [
      {
        type: "input",
        block_id: "ticket_link",
        label: { type: "plain_text", text: "Ticket Link" },
        hint: {
          type: "plain_text",
          text: "บรรทัดละ 1 รายการ ใส่ชื่อให้ลิงก์ได้ด้วย [ชื่อ](ลิงก์)",
        },
        element: {
          type: "plain_text_input",
          action_id: "ticket_link_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "[FE (Mobile) : Interface stock](https://toolings.co/company/2/projects/387?selectedTicketId=113263)",
          },
        },
      },
      {
        type: "input",
        block_id: "pr_link",
        label: { type: "plain_text", text: "PR Link" },
        element: {
          type: "plain_text_input",
          action_id: "pr_link_input",
          placeholder: {
            type: "plain_text",
            text: "เช่น https://github.com/org/repo/pull/123",
          },
        },
      },
      {
        type: "input",
        block_id: "reviewer",
        label: { type: "plain_text", text: "Reviewer" },
        element: {
          type: "multi_users_select",
          action_id: "reviewer_select",
          placeholder: { type: "plain_text", text: "เลือกคนรีวิว" },
        },
      },
      {
        type: "input",
        block_id: "priority",
        label: { type: "plain_text", text: "Priority" },
        element: {
          type: "radio_buttons",
          action_id: "priority_select",
          initial_option: priorityOption(
            PR_PRIORITIES.find(
              (priority) => priority.value === DEFAULT_PR_PRIORITY,
            ) ?? PR_PRIORITIES[0],
          ),
          options: PR_PRIORITIES.map(priorityOption),
        },
      },
      {
        type: "input",
        block_id: "watcher",
        optional: true,
        label: { type: "plain_text", text: "Watcher" },
        hint: {
          type: "plain_text",
          text: "ไม่ถูก mention ตอนโพสต์ จะ mention ใน thread หลังกด Merged",
        },
        element: {
          type: "multi_users_select",
          action_id: "watcher_select",
          max_selected_items: MAX_WATCHER_COUNT,
          placeholder: {
            type: "plain_text",
            text: "เลือกคนที่ต้องการให้รู้ตอน merge",
          },
        },
      },
      {
        type: "actions",
        block_id: "pr_options",
        elements: [
          {
            type: "checkboxes",
            action_id: "pr_options_toggle",
            options: [MORE_OPTIONS],
            ...(showMoreOptions ? { initial_options: [MORE_OPTIONS] } : {}),
          },
        ],
      },
      ...(showMoreOptions ? MORE_OPTION_BLOCKS : []),
    ],
  };
}
