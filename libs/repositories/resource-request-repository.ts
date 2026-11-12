import "server-only";

import type { QuerySnapshot } from "firebase-admin/firestore";
import { getDatabase } from "@/libs/firebase/admin";
import { toResourceRequest } from "@/libs/repositories/resource-request-records";
import type {
  ResourceRequest,
  ResourceRequestMutation,
} from "@/models/resource-request";

// One document per request, keyed by request ID, beside slackChannels rather than
// under it: a request belongs to the people involved, not to a channel. Queries
// filter on one field only, so no composite index has to be deployed.
const RESOURCE_REQUESTS_COLLECTION = "resourceRequests";

// gRPC ALREADY_EXISTS, thrown by DocumentReference.create() for a taken ID.
const ALREADY_EXISTS = 6;

function getCollection() {
  return getDatabase().collection(RESOURCE_REQUESTS_COLLECTION);
}

function toRequests(snapshot: QuerySnapshot) {
  return snapshot.docs.map((document) => toResourceRequest(document.id, document.data()));
}

// false when the ID is already taken, so the caller can draw another one.
export async function insertResourceRequest(request: ResourceRequest) {
  try {
    await getCollection().doc(request.requestId).create(request);

    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === ALREADY_EXISTS) {
      return false;
    }

    throw error;
  }
}

export async function getResourceRequest(requestId: string) {
  const snapshot = await getCollection().doc(requestId).get();

  return snapshot.exists
    ? toResourceRequest(snapshot.id, snapshot.data() ?? {})
    : null;
}

// Read, check and write as one step, so two PMs clicking at once on different
// instances cannot both decide. `mutate` may run more than once and must be pure.
export async function updateResourceRequest<T>(
  requestId: string,
  mutate: (current: ResourceRequest | undefined) => ResourceRequestMutation<T>,
) {
  const reference = getCollection().doc(requestId);

  return getDatabase().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const { update, result } = mutate(
      snapshot.exists ? toResourceRequest(snapshot.id, snapshot.data() ?? {}) : undefined,
    );

    if (update) {
      transaction.set(reference, update);
    }

    return result;
  });
}

// Records where the card was posted. Written outside a transaction: nothing
// else changes these two fields.
export async function saveResourceRequestCard(
  requestId: string,
  channelId: string,
  messageTs: string,
) {
  await getCollection().doc(requestId).update({ channelId, messageTs });
}

export async function deleteResourceRequest(requestId: string) {
  await getCollection().doc(requestId).delete();
}

export async function listResourceRequestsForPerson(personId: string) {
  return toRequests(await getCollection().where("personId", "==", personId).get());
}

// Requests whose endDate is on or after the date (YYYY-MM-DD).
export async function listResourceRequestsEndingFrom(date: string) {
  return toRequests(await getCollection().where("endDate", ">=", date).get());
}
