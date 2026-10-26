import { useState } from 'react';
import { newDocument, type SketchDocument } from './document';
export interface History { past: SketchDocument[]; present: SketchDocument; future: SketchDocument[] }
export function useDocument(initial?: SketchDocument) {
  const [history, set] = useState<History>(() => ({ past: [], present: initial ?? newDocument(), future: [] }));
  const commit = (change: (doc: SketchDocument) => SketchDocument) => set(h => {
    const next = change(h.present);
    return JSON.stringify(next) === JSON.stringify(h.present) ? h : { past: [...h.past.slice(-99), h.present], present: next, future: [] };
  });
  return { checkpoint: history,
    goTo: (index: number) => set(h => goToDrawingHistory(h, index)),
    doc: history.present, commit, canUndo: !!history.past.length, canRedo: !!history.future.length,
    undo: () => set(h => h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h),
    redo: () => set(h => h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h),
    open: (present: SketchDocument) => set({ past: [], present, future: [] }),
  };
}

export function goToDrawingHistory(history: History, index: number): History {
  const states = [...history.past, history.present, ...history.future];
  if (!Number.isInteger(index) || index < 0 || index >= states.length || index === history.past.length) return history;
  return { past: states.slice(0, index), present: states[index], future: states.slice(index + 1) };
}
