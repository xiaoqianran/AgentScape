import { PlyReader, SpzReader, transcodeSpz } from '@sparkjsdev/spark';

const extensionOf = (name = '') => String(name).split(/[?#]/, 1)[0].split('.').at(-1)?.toLowerCase() || '';

export function detectGaussianFormat({ name = '', bytes } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
  const extension = extensionOf(name);
  if (extension === 'ply' || extension === 'spz') return extension;
  if (!data?.byteLength) return null;
  const text = new TextDecoder().decode(data.subarray(0, 4));
  if (text.startsWith('ply')) return 'ply';
  const gzip = data[0] === 0x1f && data[1] === 0x8b;
  const ngsp = data[0] === 0x4e && data[1] === 0x47 && data[2] === 0x53 && data[3] === 0x50;
  return gzip || ngsp ? 'spz' : null;
}

export async function prepareGaussianRuntimeVisual({ name, bytes, transcode = transcodeSpz } = {}) {
  const inputBytes = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
  if (!inputBytes?.byteLength) throw new TypeError('Gaussian upload requires non-empty bytes');
  const inputFormat = detectGaussianFormat({ name, bytes:inputBytes });
  if (!inputFormat) throw new TypeError('Only Gaussian Splat PLY or SPZ files are supported');

  if (inputFormat === 'spz') {
    const reader = new SpzReader({ fileBytes:inputBytes });
    await reader.parseHeader();
    if (!reader.numSplats) throw new Error('SPZ contains no splats');
    return { inputFormat, runtimeFormat:'spz', bytes:inputBytes, converted:false, splatCount:reader.numSplats };
  }

  const reader = new PlyReader({ fileBytes:inputBytes });
  await reader.parseHeader();
  if (!reader.numSplats) throw new Error('PLY contains no Gaussian splats');
  const output = await transcode({
    inputs:[{ fileBytes:inputBytes, fileType:'ply', pathOrUrl:name || 'upload.ply' }],
    maxSh:3
  });
  const outputBytes = output?.fileBytes instanceof Uint8Array
    ? output.fileBytes
    : output instanceof Uint8Array
      ? output
      : null;
  if (!outputBytes?.byteLength) throw new Error('PLY to SPZ conversion produced no bytes');
  return { inputFormat, runtimeFormat:'spz', bytes:outputBytes, converted:true, splatCount:reader.numSplats };
}

export function downloadBytes(bytes, fileName, documentImpl = globalThis.document) {
  const blob = new Blob([bytes], { type:'model/spz' });
  const url = URL.createObjectURL(blob);
  const anchor = documentImpl.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
