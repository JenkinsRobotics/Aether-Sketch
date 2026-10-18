import { readDocument, serializeDocument, type SketchDocument } from './document';
export interface Recovery { doc: SketchDocument; name: string }
/** sessionStorage is isolated per tab; key also isolates host account and project. */
export function recoveryKey(account: string, project: string) { return `aether-sketch:recovery:v1:${encodeURIComponent(account)}:${encodeURIComponent(project)}`; }
export function loadRecovery(storage: Pick<Storage, 'getItem'>, key: string): Recovery | null {
  const raw = storage.getItem(key); if (!raw) return null;
  const record = JSON.parse(raw);
  if (record.version !== 1 || typeof record.name !== 'string' || record.name.length > 200) throw Error('The saved draft is not compatible.');
  return { doc: readDocument(JSON.stringify(record.doc)), name: record.name };
}
export function saveRecovery(storage: Pick<Storage, 'setItem'>, key: string, value: Recovery) {
  const doc = readDocument(serializeDocument(value.doc));
  storage.setItem(key, JSON.stringify({version:1,name:value.name,doc}));
}
