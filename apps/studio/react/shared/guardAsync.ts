/** Report both synchronous command errors and rejected asynchronous actions. */
export function guardAsync(scope: string, action: (() => Promise<unknown> | void) | Promise<unknown> | void): void {
  try {
    const result = typeof action === 'function' ? action() : action;
    Promise.resolve(result).catch((error) => console.warn(`[Studio] ${scope}`, error));
  } catch (error) {
    console.warn(`[Studio] ${scope}`, error);
  }
}
