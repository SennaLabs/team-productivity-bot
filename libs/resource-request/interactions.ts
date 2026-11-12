import { after } from "next/server";
import {
  createResourceRequestCard,
  decodeManageValue,
  describeChanges,
  notices,
  refusalNotice,
  RESOURCE_REQUEST_IDS,
  RESOURCE_REQUEST_PREFIX,
  statusLabel,
} from "@/libs/resource-request/messages";
import {
  createApproveModal,
  createCancelModal,
  createMessageModal,
  createRejectModal,
  createRequestInfoModal,
  createResourceRequestModal,
  readNote,
  readResourceRequestForm,
} from "@/libs/resource-request/modals";
import {
  CANCELLABLE_STATUSES,
  canDecide,
  canManage,
  cancelResourceRequest,
  decideResourceRequest,
  editResourceRequest,
  findOverlaps,
  getResourceRequestSettings,
  newResourceRequest,
  newResourceRequestId,
  OPEN_STATUSES,
  validateResourceRequestForm,
} from "@/libs/resource-request/requests";
import {
  deleteResourceRequest,
  getResourceRequest,
  insertResourceRequest,
  listResourceRequestsForPerson,
  saveResourceRequestCard,
  updateResourceRequest,
} from "@/libs/repositories/resource-request-repository";
import {
  getSlackMember,
  getSlackPermalink,
  openSlackModal,
  postSlackMessage,
  updateSlackMessage,
  updateSlackModal,
} from "@/libs/utils/client";
import type {
  ResourceRequest,
  ResourceRequestDecision,
  ResourceRequestInput,
} from "@/models/resource-request";
import type { SlackInteractionPayload, SlackModal } from "@/models/slack-api";

const MAX_ID_ATTEMPTS = 5;

export function isResourceRequestPayload(payload: SlackInteractionPayload) {
  return [
    payload.callback_id,
    payload.view?.callback_id,
    payload.actions?.[0]?.action_id,
  ].some((id) => id?.startsWith(RESOURCE_REQUEST_PREFIX));
}

function runAfterResponse(what: string, task: () => Promise<void>) {
  after(async () => {
    try {
      await task();
    } catch (error) {
      console.error(`Resource request: ${what} failed`, error);
    }
  });
}

// For notifications: one failed DM must not stop the rest.
async function safely(what: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.error(`Resource request: ${what} failed`, error);
  }
}

function sendDm(userId: string, text: string) {
  return safely("DM", () => postSlackMessage(userId, { text }));
}

function postInThread(request: ResourceRequest, text: string) {
  if (!request.channelId || !request.messageTs) {
    return Promise.resolve();
  }

  const { channelId, messageTs } = request;

  return safely("thread reply", () => postSlackMessage(channelId, { text }, messageTs));
}

// The stored request is the truth; a card that fails to redraw is only logged.
function redrawCard(request: ResourceRequest) {
  if (!request.channelId || !request.messageTs) {
    return Promise.resolve();
  }

  const { channelId, messageTs } = request;

  return safely("card redraw", () =>
    updateSlackMessage(channelId, messageTs, createResourceRequestCard(request)),
  );
}

// ---------------------------------------------------------------------------
// Create

export async function openCreateModal(triggerId: string) {
  await openSlackModal(
    triggerId,
    createResourceRequestModal(getResourceRequestSettings().projects),
  );
}

async function createRequest(input: ResourceRequestInput, userId: string, fallbackName?: string) {
  const { channelId } = getResourceRequestSettings();

  if (!channelId) {
    throw new Error("RESOURCE_REQUEST_CHANNEL_ID is not configured");
  }

  const member = await getSlackMember(userId, "resource_requester");
  let request: ResourceRequest | null = null;

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS && !request; attempt++) {
    const candidate = newResourceRequest(
      input,
      newResourceRequestId(),
      { id: userId, name: member?.name ?? fallbackName ?? null },
      new Date(),
    );

    if (await insertResourceRequest(candidate)) {
      request = candidate;
    }
  }

  if (!request) {
    throw new Error("Could not allocate a unique request ID");
  }

  const { requestId } = request;
  let messageTs: string | undefined;

  try {
    messageTs = await postSlackMessage(channelId, createResourceRequestCard(request));
  } catch (error) {
    // Without a card nobody can act on the request, so do not leave it behind.
    await safely("remove unposted request", () => deleteResourceRequest(requestId));
    throw error;
  }

  if (!messageTs) {
    return request;
  }

  const ts = messageTs;

  // The buttons work by request ID either way; only later card redraws need this.
  await safely("save card location", () => saveResourceRequestCard(requestId, channelId, ts));

  return { ...request, channelId, messageTs };
}

function handleCreateSubmission(payload: SlackInteractionPayload, userId: string) {
  const form = validateResourceRequestForm(readResourceRequestForm(payload));

  if (!form.ok) {
    return Response.json({ response_action: "errors", errors: form.errors });
  }

  runAfterResponse("create", async () => {
    let request: ResourceRequest;

    try {
      request = await createRequest(form.input, userId, payload.user?.name);
    } catch (error) {
      console.error("Resource request: create failed", error);
      await sendDm(userId, notices.submitFailed);
      return;
    }

    let link = request.channelId ? `<#${request.channelId}>` : "";

    if (request.channelId && request.messageTs) {
      const { channelId, messageTs } = request;

      await safely("permalink", async () => {
        const permalink = await getSlackPermalink(channelId, messageTs);

        if (permalink) {
          link = `<${permalink}|ดูการ์ด>`;
        }
      });
    }

    await sendDm(userId, notices.submitted(request, link));

    if (request.ownerPmId !== userId) {
      await sendDm(request.ownerPmId, notices.askOwner(request, link));
    }
  });

  return new Response(null, { status: 200 });
}

// ---------------------------------------------------------------------------
// Buttons and the "⋯" menu open a modal that depends on the stored request.
// The trigger_id expires 3 seconds after the click, so a loading modal opens
// first and is replaced once the request has been read.

async function openLoadingModal(
  triggerId: string,
  build: () => Promise<SlackModal>,
) {
  const viewId = await openSlackModal(
    triggerId,
    createMessageModal("กำลังโหลด", ":hourglass_flowing_sand: กำลังโหลดคำขอ..."),
  );

  if (!viewId) {
    return;
  }

  runAfterResponse("load modal", async () => {
    let view: SlackModal;

    try {
      view = await build();
    } catch (error) {
      console.error("Resource request: building modal failed", error);
      view = createMessageModal("เกิดข้อผิดพลาด", ":warning: โหลดคำขอไม่สำเร็จ ลองใหม่อีกครั้ง");
    }

    await updateSlackModal(viewId, view);
  });
}

const notFoundModal = () =>
  createMessageModal("ไม่พบคำขอ", "ไม่พบข้อมูลคำขอนี้ (การ์ดอาจถูกลบไปแล้ว)");

async function buildDecisionModal(
  requestId: string,
  userId: string,
  actionId: string,
): Promise<SlackModal> {
  const request = await getResourceRequest(requestId);

  if (!request) {
    return notFoundModal();
  }

  if (!canDecide(userId, request, getResourceRequestSettings().adminIds)) {
    return createMessageModal(
      "ไม่มีสิทธิ์",
      `:lock: คำขอนี้ต้องให้ <@${request.ownerPmId}> เป็นคนอนุมัติ`,
    );
  }

  if (!OPEN_STATUSES.includes(request.status)) {
    return createMessageModal(
      "ตัดสินใจไปแล้ว",
      `คำขอ ${request.requestId} ${statusLabel(request.status)} โดย <@${request.decidedBy}>`,
    );
  }

  if (actionId === RESOURCE_REQUEST_IDS.rejectButton) {
    return createRejectModal(request);
  }

  if (actionId === RESOURCE_REQUEST_IDS.infoButton) {
    return createRequestInfoModal(request);
  }

  // Approving shows whether the person is already lent out over the same dates.
  // If that lookup fails, the PM can still decide, just without the warning.
  try {
    return createApproveModal(
      request,
      findOverlaps(request, await listResourceRequestsForPerson(request.personId)),
    );
  } catch (error) {
    console.error("Resource request: overlap check failed", error);
    return createApproveModal(request);
  }
}

async function buildManageModal(requestId: string, userId: string, choice: "edit" | "cancel") {
  const request = await getResourceRequest(requestId);

  if (!request) {
    return notFoundModal();
  }

  const settings = getResourceRequestSettings();

  if (!canManage(userId, request, settings.adminIds)) {
    return createMessageModal(
      "ไม่มีสิทธิ์",
      `:lock: เฉพาะ <@${request.requesterId}> ที่ขอ ที่แก้ไขหรือยกเลิกคำขอนี้ได้`,
    );
  }

  if (choice === "edit") {
    return OPEN_STATUSES.includes(request.status)
      ? createResourceRequestModal(settings.projects, request)
      : createMessageModal(
          "แก้ไขไม่ได้",
          `คำขอ ${request.requestId} ${statusLabel(request.status)} แล้ว แก้ไขไม่ได้`,
        );
  }

  return CANCELLABLE_STATUSES.includes(request.status)
    ? createCancelModal(request)
    : createMessageModal("ยกเลิกไม่ได้", `คำขอ ${request.requestId} ${statusLabel(request.status)} แล้ว`);
}

async function handleBlockAction(payload: SlackInteractionPayload, userId: string) {
  const action = payload.actions?.[0];
  const triggerId = payload.trigger_id;

  if (!action?.action_id || !triggerId) {
    return new Response(null, { status: 200 });
  }

  try {
    if (action.action_id === RESOURCE_REQUEST_IDS.manageMenu) {
      const picked = decodeManageValue(action.selected_option?.value);

      if (picked) {
        await openLoadingModal(triggerId, () =>
          buildManageModal(picked.requestId, userId, picked.choice),
        );
      }
    } else if (action.value) {
      // Each decision button carries its request ID as the value.
      const requestId = action.value;

      await openLoadingModal(triggerId, () =>
        buildDecisionModal(requestId, userId, action.action_id ?? ""),
      );
    }
  } catch (error) {
    console.error("Resource request: opening modal failed", error);
  }

  return new Response(null, { status: 200 });
}

// ---------------------------------------------------------------------------
// Modal submissions

async function applyDecision(requestId: string, actorId: string, decision: ResourceRequestDecision) {
  const { adminIds } = getResourceRequestSettings();
  const result = await updateResourceRequest(requestId, (current) =>
    decideResourceRequest(current, actorId, decision, adminIds, new Date()),
  );

  if (!result.ok) {
    await sendDm(actorId, refusalNotice(result));
    return;
  }

  const request = result.request;

  await redrawCard(request);

  if (decision.type === "approve") {
    await sendDm(request.requesterId, notices.approvedToRequester(request, actorId));
    await sendDm(request.personId, notices.approvedToPerson(request, actorId));
  } else if (decision.type === "reject") {
    await sendDm(request.requesterId, notices.rejected(request, actorId));
  } else {
    await postInThread(request, notices.needInfo(request, actorId));
  }
}

function handleDecisionSubmission(
  payload: SlackInteractionPayload,
  userId: string,
  type: ResourceRequestDecision["type"],
) {
  const requestId = payload.view?.private_metadata ?? "";
  const note = readNote(payload);

  if (type !== "approve" && !note) {
    return Response.json({
      response_action: "errors",
      errors: { note: "กรุณากรอกข้อความ" },
    });
  }

  runAfterResponse("decision", async () => {
    try {
      await applyDecision(requestId, userId, { type, note });
    } catch (error) {
      console.error("Resource request: saving decision failed", { requestId, error });
      await sendDm(userId, notices.saveFailed);
    }
  });

  return new Response(null, { status: 200 });
}

function handleEditSubmission(payload: SlackInteractionPayload, userId: string) {
  const form = validateResourceRequestForm(readResourceRequestForm(payload));

  if (!form.ok) {
    return Response.json({ response_action: "errors", errors: form.errors });
  }

  const requestId = payload.view?.private_metadata ?? "";

  runAfterResponse("edit", async () => {
    const { adminIds } = getResourceRequestSettings();
    let result;

    try {
      result = await updateResourceRequest(requestId, (current) =>
        editResourceRequest(current, userId, form.input, adminIds),
      );
    } catch (error) {
      console.error("Resource request: edit failed", { requestId, error });
      await sendDm(userId, notices.saveFailed);
      return;
    }

    if (!result.ok) {
      await sendDm(userId, refusalNotice(result, "แก้ไข"));
      return;
    }

    await redrawCard(result.request);
    await postInThread(
      result.request,
      notices.edited(result.request, userId, describeChanges(result.previous, result.request)),
    );
  });

  return new Response(null, { status: 200 });
}

function handleCancelSubmission(payload: SlackInteractionPayload, userId: string) {
  const requestId = payload.view?.private_metadata ?? "";
  const note = readNote(payload);

  runAfterResponse("cancel", async () => {
    const { adminIds } = getResourceRequestSettings();
    let result;

    try {
      result = await updateResourceRequest(requestId, (current) =>
        cancelResourceRequest(current, userId, note, adminIds, new Date()),
      );
    } catch (error) {
      console.error("Resource request: cancel failed", { requestId, error });
      await sendDm(userId, notices.saveFailed);
      return;
    }

    if (!result.ok) {
      await sendDm(userId, refusalNotice(result, "ยกเลิก"));
      return;
    }

    await redrawCard(result.request);
    await postInThread(result.request, notices.cancelled(result.request, result.previous, userId));
  });

  return new Response(null, { status: 200 });
}

// Entry point from libs/utils/interactions.ts, after the Slack signature check.
export async function handleResourceRequestInteraction(payload: SlackInteractionPayload) {
  const userId = payload.user?.id;

  if (!userId) {
    return new Response(null, { status: 200 });
  }

  if (payload.type === "shortcut") {
    if (payload.trigger_id) {
      try {
        await openCreateModal(payload.trigger_id);
      } catch (error) {
        console.error("Resource request: shortcut modal failed to open", error);
      }
    }

    return new Response(null, { status: 200 });
  }

  if (payload.type === "block_actions") {
    return handleBlockAction(payload, userId);
  }

  if (payload.type !== "view_submission") {
    return new Response(null, { status: 200 });
  }

  switch (payload.view?.callback_id) {
    case RESOURCE_REQUEST_IDS.createModal:
      return handleCreateSubmission(payload, userId);
    case RESOURCE_REQUEST_IDS.editModal:
      return handleEditSubmission(payload, userId);
    case RESOURCE_REQUEST_IDS.approveModal:
      return handleDecisionSubmission(payload, userId, "approve");
    case RESOURCE_REQUEST_IDS.rejectModal:
      return handleDecisionSubmission(payload, userId, "reject");
    case RESOURCE_REQUEST_IDS.infoModal:
      return handleDecisionSubmission(payload, userId, "need_info");
    case RESOURCE_REQUEST_IDS.cancelModal:
      return handleCancelSubmission(payload, userId);
    default:
      return new Response(null, { status: 200 });
  }
}
