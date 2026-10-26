import { expect, test } from 'vitest';
import { goToDrawingHistory } from './useDocument';
import { newDocument } from './document';
import { describeSketchEdit } from './history-description';

test('history navigation retains both sides of the document chain', () => {
  const first = newDocument(), second = {...first, widthPx: 500}, third = {...second, widthPx: 700};
  const history = { past:[first,second], present:third, future:[] };
  const previous = goToDrawingHistory(history,1);
  expect(previous).toEqual({past:[first],present:second,future:[third]});
  expect(goToDrawingHistory(previous,2)).toEqual(history);
  expect(goToDrawingHistory(previous,-1)).toBe(previous);
  expect(describeSketchEdit(first,second)).toBe('Resize drawing');
});
