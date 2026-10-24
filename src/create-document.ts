import { newDocument, serializeDocument } from './document';
/** Product-owned library factory; independent of the editor and recovery state. */
export function createDocument(name: string): File {
  const base = name.trim().replace(/\.aethersketch$/i, '').trim();
  if (!base) throw new Error('Enter a sketch name.');
  return new File([serializeDocument(newDocument())], `${base}.aethersketch`, { type: 'application/json' });
}
