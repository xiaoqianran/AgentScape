import type { CSSProperties } from 'react';

const paths = {
  worlds: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  create: 'm12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z',
  cube: 'm12 3 9 5v8l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v8 M7.5 5.5l9 5',
  agent: 'M8 5V3m8 2V3 M5 7h14v12H5z M8 11h1m6 0h1 M9 15h6 M2 11v4m20-4v4',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Zm5.5-2 5 5',
  chevron: 'm9 5 7 7-7 7',
  close: 'm6 6 12 12M18 6 6 18',
  panel: 'M3 4h18v16H3z M9 4v16',
  move: 'M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3',
  rotate: 'M20 10a8 8 0 1 0 0 5 M20 4v6h-6',
  undo: 'M8 5 3 10l5 5 M3 10h11a6 6 0 0 1 6 6v3',
  redo: 'm16 5 5 5-5 5 M21 10H10a6 6 0 0 0-6 6v3',
  settings: 'M4 7h16M4 17h16 M8 4v6m8 4v6',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  folder: 'M3 7V4h7l2 3h9v13H3z',
  image: 'M3 3h18v18H3z M3 16l5-5 5 5 3-3 5 5 M15 7h.01'
} as const;
export type StudioIconName = keyof typeof paths;

export function StudioIcon({ name, size = 18, style }: { name:StudioIconName; size?:number; style?:CSSProperties }) {
  return <svg className="studio-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style}><path d={paths[name]} /></svg>;
}
