/** Expected cancellations stay quiet; unexpected failures stay observable. */
export function reportFailure(scope, error) {
  if (error) console.warn(`[Observatory] ${scope}`, error);
}

/** A queued chain must continue after a previous operation failed, without hiding why. */
export const ignorePrevious = (error) => reportFailure('上一次异步操作失败', error);
