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
  exportPng: () => Promise<{ bytes:Uint8Array; width:number; height:number }>;
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
        const blob = await canvasBlob(canvas);
        if (blob.size > 20 * 1024 * 1024) throw new Error('最终 RGBA PNG 超过 20 MiB，请进一步裁剪');
        return { bytes:new Uint8Array(await blob.arrayBuffer()), width:canvas.width, height:canvas.height };
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
              paintAt(event.clientX, event.clientY);
            }}
            onPointerMove={(event) => {
              if (!drawingRef.current || disabled || !ready) return;
              paintAt(event.clientX, event.clientY);
            }}
            onPointerUp={(event) => {
              drawingRef.current = false;
              event.currentTarget.releasePointerCapture?.(event.pointerId);
            }}
            onPointerCancel={() => { drawingRef.current = false; }}
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
