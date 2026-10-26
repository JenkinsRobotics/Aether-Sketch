import { useMemo } from 'react';
import { AetherIcon, HistoryPanel } from '@aether/ui';
import type { SketchDocument } from './document';
import type { useDocument } from './useDocument';

import { describeSketchEdit } from "./history-description";

const identities = new WeakMap<SketchDocument, string>();
let serial = 0;
export function SketchHistoryPanel({ history, writable }: { history: ReturnType<typeof useDocument>; writable: boolean }) {
  const entries = useMemo(() => {
    const { past, present, future } = history.checkpoint;
    const states = [...past, present, ...future];
    return states.slice(1).map((state, index) => {
      if (!identities.has(state)) identities.set(state, `drawing-edit-${++serial}`);
      return { id: identities.get(state)!, label: describeSketchEdit(states[index], state), icon: <AetherIcon name="sketch-nodes"/>, category: 'Drawing edits',
        description: `${state.layers.length} layers · ${state.layers.reduce((count, layer) => count + layer.paths.length, 0)} paths`,
        inactive: index + 1 > past.length, current: index + 1 === past.length,
        actions: [{ id: 'restore', label: 'Return to this step', disabled: !writable || index + 1 === past.length, icon: <AetherIcon name="history"/> }],
      };
    });
  }, [history.checkpoint, writable]);
  return <HistoryPanel embedded entries={entries} emptyMessage="Drawing edits will appear here during this session." onCommand={(id, command) => {
    const index = entries.findIndex(entry => entry.id === id);
    if (command === 'restore' && writable && index >= 0) history.goTo(index + 1);
  }}/>;
}
