import { AuthoringWorldStore } from "../../../studio/persistence/AuthoringWorldStore.js";

let store;

function getStore() {
  if (!store) store = new AuthoringWorldStore();
  return store;
}

function formatDraftTime(updatedAt) {
  if (!updatedAt) return "Saved recently";

  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return "Saved recently";

  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} weeks ago`;

  const months = Math.max(1, Math.floor(days / 30));
  return `${months} months ago`;
}

export function toRecentDraft(record) {
  return {
    id: `authoring:${record.id}`,
    authoringId: record.id,
    kind: "authoring",
    name: record.name || record.id,
    time: formatDraftTime(record.updatedAt),
    group: "previous",
    art: "draft",
    updatedAt: record.updatedAt || null,
  };
}

export async function loadAuthoringRecents() {
  const records = await getStore().list();
  return records.map(toRecentDraft);
}
