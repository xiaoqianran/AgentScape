// Browser-owned drafts. No source bytes leave the browser until generation starts.
export const DRAFT_DATABASE = 'agentscape-image-workbench-v1';
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;

export function validateImageFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 图片');
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('单张图片须大于 0 且不超过 20 MiB');
}

export function restoredDraft(draft) {
  return ['uploading', 'generating', 'queued'].includes(draft.status)
    ? { ...draft, status: 'interrupted', error: '上次任务中断；继续时会优先查询已有任务。' }
    : draft;
}

export async function openImageDraftStore(indexedDBImpl=globalThis.indexedDB) {
  if (!indexedDBImpl?.open) throw new Error('IndexedDB 不可用，无法保存图片物体草稿');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(DRAFT_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transact = (mode, operation) => new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', mode);
    const request = operation(tx.objectStore('workspace'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('草稿保存被中断'));
  });
  return {
    read: () => transact('readonly', (store) => store.get('current')),
    write: (workspace) => transact('readwrite', (store) => store.put(workspace, 'current')),
    close: () => db.close()
  };
}

// Only separate disconnected foreground regions, never claim semantic recognition.
// Intended for downsampled images (at most 512 px per side).
export function findForegroundRegions(rgba, width, height, { tolerance = 32, minArea = 24 } = {}) {
  if (rgba.length !== width * height * 4 || width < 1 || height < 1 || width * height > 512 * 512) {
    throw new Error('候选识别需要不超过 512×512 的 RGBA 图像');
  }
  const size = width * height;
  const corners = [0, width - 1, (height - 1) * width, size - 1];
  const transparent = corners.every((i) => rgba[i * 4 + 3] < 16);
  const background = [0, 1, 2].map((c) => corners.reduce((sum, i) => sum + rgba[i * 4 + c], 0) / 4);
  const distance = (i) => Math.max(...background.map((v, c) => Math.abs(rgba[i * 4 + c] - v)));
  if (!transparent && corners.some((i) => distance(i) > tolerance)) {
    throw new Error('背景不够均匀，请使用框选和擦除画笔提取物体。');
  }
  const foreground = new Uint8Array(size);
  for (let i = 0; i < size; i++) foreground[i] = rgba[i * 4 + 3] > 16 ? 1 : 0;
  const queue = new Int32Array(size);
  const neighbors = (i, visit) => {
    if (i % width) visit(i - 1);
    if (i % width < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < size - width) visit(i + width);
  };
  if (!transparent) {
    let head = 0, tail = 0;
    const add = (i) => {
      if (foreground[i] && distance(i) <= tolerance) { foreground[i] = 0; queue[tail++] = i; }
    };
    for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
    while (head < tail) neighbors(queue[head++], add);
  }
  const regions = [];
  for (let i = 0; i < size; i++) {
    if (!foreground[i]) continue;
    let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0;
    queue[0] = i;
    foreground[i] = 0;
    while (head < tail) {
      const pixel = queue[head++], x = pixel % width, y = Math.floor(pixel / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      neighbors(pixel, (next) => {
        if (foreground[next]) { foreground[next] = 0; queue[tail++] = next; }
      });
    }
    if (tail >= minArea) regions.push({ x: left, y: top, width: right - left + 1, height: bottom - top + 1, pixels: queue.slice(0, tail) });
  }
  return regions.sort((a, b) => b.pixels.length - a.pixels.length).slice(0, 24);
}

export async function runImageObjectQueue({ drafts, process, update, shouldStop = () => false }) {
  for (const draft of drafts) {
    if (shouldStop()) break;
    try {
      await process(draft);
    } catch (error) {
      await update(draft.id, { status: 'failed', error: error?.message || String(error) });
    }
  }
}
