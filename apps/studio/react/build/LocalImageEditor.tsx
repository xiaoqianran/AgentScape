import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  cropRect,
  normalizeCropInsets,
  paintAlphaBrush,
  resetAlpha,
  type AlphaBrushMode,
  type CropInsets
} from './LocalImageEditorCore';

export type LocalImageEditorHandle = {
  exportPng: () => Promise<{ bytes:Uint8Array; width:number; height:number; crop:{x:number; y:number; width:number; height:number} }>;
};

type LocalImageEditorProps = {
  sourceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  disabled?: boolean;
};

const EMPTY_CROP: CropInsets = { left:0, top:0, right:0, bottom:0 };

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('RGBA PNG 导出失败')), 'image/png');
  });
}

export const LocalImageEditor = forwardRef<LocalImageEditorHandle, LocalImageEditorProps>(
  function LocalImageEditor({ sourceUrl, sourceWidth, sourceHeight, disabled=false }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const baseRef = useRef<ImageData | null>(null);
    const workingRef = useRef<ImageData | null>(null);
    const drawingRef = useRef(false);
    const selectionStart = useRef<{x:number; y:number} | null>(null);
    const sourceRect = useRef({x:0, y:0, width:sourceWidth, height:sourceHeight});
    const [boxMode, setBoxMode] = useState(true);
    const [crop, setCrop] = useState<CropInsets>(EMPTY_CROP);
    const [brushMode, setBrushMode] = useState<AlphaBrushMode>('erase');
    const [brushSize, setBrushSize] = useState(28);
    const [ready, setReady] = useState(false);
    const [edited, setEdited] = useState(false);
    const [workingSize, setWorkingSize] = useState({ width:sourceWidth, height:sourceHeight });

    const drawWorking = () => {
      const canvas = canvasRef.current;
      const working = workingRef.current;
      if (!canvas || !working) return;
      if (canvas.width !== working.width || canvas.height !== working.height) {
        canvas.width = working.width;
        canvas.height = working.height;
      }
      canvas.getContext('2d', { willReadFrequently:true })?.putImageData(working, 0, 0);
    };

    const applyCrop = (nextCrop: CropInsets) => {
      const image = imageRef.current;
      const canvas = canvasRef.current;
      if (!image || !canvas) return;
      const rect = cropRect(image.naturalWidth, image.naturalHeight, nextCrop);
      sourceRect.current = rect;
      canvas.width = rect.width;
      canvas.height = rect.height;
      const context = canvas.getContext('2d', { willReadFrequently:true });
      if (!context) throw new Error('浏览器无法创建 Crop Canvas');
      context.clearRect(0, 0, rect.width, rect.height);
      context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      const base = context.getImageData(0, 0, rect.width, rect.height);
      baseRef.current = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
      workingRef.current = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
      setWorkingSize({ width:rect.width, height:rect.height });
      setEdited(false);
      setReady(true);
    };

    useEffect(() => {
      let cancelled = false;
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (cancelled) return;
        imageRef.current = image;
        setCrop(EMPTY_CROP);
        applyCrop(EMPTY_CROP);
      };
      image.onerror = () => {
        if (!cancelled) setReady(false);
      };
      image.src = sourceUrl;
      return () => {
        cancelled = true;
        imageRef.current = null;
        baseRef.current = null;
        workingRef.current = null;
      };
    // source dimensions deliberately force editor reset when a new draft is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceUrl, sourceWidth, sourceHeight]);

    useImperativeHandle(ref, () => ({
      async exportPng() {
        const canvas = canvasRef.current;
        if (!canvas || !ready) throw new Error('本地图像编辑器尚未就绪');
        drawWorking();
        const pixels = workingRef.current?.data;
        if (!pixels?.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('物体已完全透明，请恢复物体区域');
        const blob = await canvasBlob(canvas);
        if (blob.size > 20 * 1024 * 1024) throw new Error('最终 RGBA PNG 超过 20 MiB，请进一步裁剪');
        return { bytes:new Uint8Array(await blob.arrayBuffer()), width:canvas.width, height:canvas.height, crop:{...sourceRect.current} };
      }
    }), [ready]);

    const updateCrop = (key: keyof CropInsets, value: number) => {
      const next = normalizeCropInsets({ ...crop, [key]:value });
      setCrop(next);
    };

    const applySelectedCrop = () => {
      applyCrop(crop);
    };

    const resetMask = () => {
      const working = workingRef.current;
      const base = baseRef.current;
      if (!working || !base) return;
      resetAlpha(working.data, base.data);
      drawWorking();
      setEdited(false);
    };

    const paintAt = (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const working = workingRef.current;
      const base = baseRef.current;
      if (!canvas || !working || !base) return;
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = (clientX - bounds.left) * canvas.width / bounds.width;
      const y = (clientY - bounds.top) * canvas.height / bounds.height;
      const imageRadius = brushSize * canvas.width / bounds.width;
      paintAlphaBrush(
        working.data,
        base.data,
        working.width,
        working.height,
        x,
        y,
        imageRadius,
        brushMode
      );
      drawWorking();
      setEdited(true);
    };

    return (
      <div className="local-image-editor">
        <div className="local-image-mask-actions">
          <button type="button" disabled={disabled || !ready} data-active={boxMode} onClick={() => setBoxMode(true)}>框选物体</button>
          <button type="button" disabled={disabled || !ready} data-active={!boxMode} onClick={() => setBoxMode(false)}>修正边界</button>
          <button type="button" disabled={disabled || !ready} onClick={() => { setCrop(EMPTY_CROP); applyCrop(EMPTY_CROP); }}>恢复整图</button>
        </div>
        <small>{boxMode ? '在图片上拖出矩形，松开后保留选中区域。保存后可恢复整图继续提取。' : '使用擦除／恢复画笔修正背景。'}</small>
        <div className="local-image-editor-toolbar">
          <strong>Crop</strong>
          <small>先裁剪，再修正 Alpha；重新应用 Crop 会重置 Mask。</small>
        </div>
        <div className="local-image-crop-grid">
          {(['left','top','right','bottom'] as const).map((key) => (
            <label key={key}>
              <span>{key}</span>
              <input
                type="range"
                min="0"
                max="45"
                step="1"
                value={Math.round(crop[key])}
                disabled={disabled || !ready}
                onChange={(event) => updateCrop(key, Number(event.target.value))}
              />
              <code>{Math.round(crop[key])}%</code>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="local-image-editor-secondary"
          disabled={disabled || !ready}
          onClick={applySelectedCrop}
        >
          应用裁剪
        </button>

        <div className="local-image-editor-toolbar local-image-mask-toolbar">
          <div><strong>Alpha Mask</strong><small>{edited ? '已人工修改' : '当前使用源图 Alpha'}</small></div>
          <div className="local-image-mask-actions">
            <button
              type="button"
              data-active={brushMode === 'erase'}
              disabled={disabled || !ready}
              onClick={() => setBrushMode('erase')}
            >Erase</button>
            <button
              type="button"
              data-active={brushMode === 'restore'}
              disabled={disabled || !ready}
              onClick={() => setBrushMode('restore')}
            >Restore</button>
            <button type="button" disabled={disabled || !ready} onClick={resetMask}>Reset</button>
          </div>
        </div>
        <label className="local-image-brush-size">
          <span>Brush</span>
          <input
            type="range"
            min="6"
            max="80"
            step="2"
            value={brushSize}
            disabled={disabled || !ready}
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
          <code>{brushSize}px</code>
        </label>
        <div className="local-image-editor-canvas-wrap">
          <div className="local-image-transparency-grid" />
          <canvas
            ref={canvasRef}
            className="local-image-editor-canvas"
            aria-label="本地 RGBA 编辑画布"
            onPointerDown={(event) => {
              if (disabled || !ready) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drawingRef.current = true;
              if (boxMode) {
                const bounds = event.currentTarget.getBoundingClientRect();
                selectionStart.current = {x:(event.clientX-bounds.left)*event.currentTarget.width/bounds.width, y:(event.clientY-bounds.top)*event.currentTarget.height/bounds.height};
                return;
              }
              paintAt(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
              if (!drawingRef.current || disabled || !ready) return;
              if (boxMode && selectionStart.current) {
                drawWorking();
                const canvas = event.currentTarget;
                const bounds = canvas.getBoundingClientRect();
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.strokeStyle = '#bca2e8'; ctx.lineWidth = Math.max(2, canvas.width / bounds.width * 2);
                  ctx.strokeRect(selectionStart.current.x, selectionStart.current.y, (event.clientX-bounds.left)*canvas.width/bounds.width-selectionStart.current.x, (event.clientY-bounds.top)*canvas.height/bounds.height-selectionStart.current.y);
                }
                return;
              }
              paintAt(event.clientX, event.clientY);
            }}
            onPointerUp={(event) => {
              drawingRef.current = false;
              if (boxMode && selectionStart.current) {
                const canvas = event.currentTarget;
                const bounds = canvas.getBoundingClientRect();
                const endX = Math.max(0, Math.min(canvas.width, (event.clientX-bounds.left)*canvas.width/bounds.width));
                const endY = Math.max(0, Math.min(canvas.height, (event.clientY-bounds.top)*canvas.height/bounds.height));
                const x = Math.floor(Math.min(selectionStart.current.x, endX));
                const y = Math.floor(Math.min(selectionStart.current.y, endY));
                const width = Math.floor(Math.abs(endX-selectionStart.current.x));
                const height = Math.floor(Math.abs(endY-selectionStart.current.y));
                drawWorking();
                if (width >= 2 && height >= 2) {
                  const ctx = canvas.getContext('2d')!;
                  const next = ctx.getImageData(x, y, width, height);
                  if (baseRef.current) ctx.putImageData(baseRef.current, 0, 0);
                  baseRef.current = ctx.getImageData(x, y, width, height);
                  workingRef.current = next;
                  sourceRect.current = {x:sourceRect.current.x+x, y:sourceRect.current.y+y, width, height};
                  setWorkingSize({width, height});
                  drawWorking();
                }
                selectionStart.current = null;
              }
              event.currentTarget.releasePointerCapture?.(event.pointerId);
            }}
            onPointerCancel={() => { drawingRef.current = false; selectionStart.current = null; drawWorking(); }}
          />
        </div>
        <div className="local-image-editor-status">
          <span>{workingSize.width} × {workingSize.height}</span>
          <span>RGBA PNG</span>
          <span>{edited ? 'Human mask edited' : 'Mask unchanged'}</span>
        </div>
      </div>
    );
  }
);
