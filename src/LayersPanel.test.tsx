// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LayersPanel } from './LayersPanel';
import { newDocument } from './document';

it('lists board items in a Board section and selects them from the tree', () => {
  const doc = newDocument();
  doc.board = [
    { id: 'n', kind: 'sticky', x: 0, y: 0, width: 180, height: 180, text: 'Jaw range' },
    { id: 't', kind: 'table', x: 300, y: 0, width: 200, height: 90, cells: [['Channel', 'Joint']] },
    { id: 'c', kind: 'connector', x: 0, y: 0, width: 0, height: 0, from: 'n', to: 't' },
  ];
  const onSelectBoard = vi.fn(), onSelect = vi.fn();
  render(<LayersPanel doc={doc} layer={doc.layers[0]} selected={[]} onSelect={onSelect} commit={vi.fn()} onSelectBoard={onSelectBoard} />);
  expect(screen.getByText('Board')).toBeTruthy();
  expect(screen.queryByText(/Connector/)).toBeNull();
  fireEvent.click(screen.getByText('Note · Jaw range'));
  expect(onSelectBoard).toHaveBeenLastCalledWith(['n']);
  expect(screen.getByText('Table · Channel')).toBeTruthy();
  expect(onSelect).not.toHaveBeenCalled();
});
