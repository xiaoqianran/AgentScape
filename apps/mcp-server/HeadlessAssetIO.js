// Node has Blob but no FileReader; GLTFExporter needs these two asynchronous reads.
export function installHeadlessAssetIO() {
 globalThis.ProgressEvent ||= class ProgressEvent { constructor(type,init={}) { this.type=type; Object.assign(this,init); } };
 globalThis.FileReader ||= class FileReader {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();},error=>{this.error=error;this.onerror?.(error);}); }
  readAsDataURL(blob) { blob.arrayBuffer().then(bytes=>{this.result=`data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onloadend?.();},error=>{this.error=error;this.onerror?.(error);}); }
 };
}
