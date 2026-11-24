/** Minimum usable short edge for a visual evidence frame, not an aesthetic verdict. */
export function isUsableVisualCaptureSize(width,height){
  return Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>=32&&height>=32;
}
