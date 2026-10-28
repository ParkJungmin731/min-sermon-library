// Native IndexedDB opens the existing Dexie database without changing its version
// (Dexie v1 uses native version 10). Flexible record fields need no schema upgrade.
export const DB_NAME = 'SermonDB';
export const BACKUP_VERSION = 1;
export const STATUS = { Idea: '아이디어', Writing: '작성 중', Complete: '완료' };
let connection;
export function openDB() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sermons')) {
        const s = db.createObjectStore('sermons', { keyPath: 'id', autoIncrement: true });
        for (const key of ['title', 'date', 'status']) s.createIndex(key, key);
      }
      if (!db.objectStoreNames.contains('documents')) {
        const d = db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
        for (const key of ['sermonId', 'title']) d.createIndex(key, key);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(new Error('다른 서재 탭을 닫고 다시 열어 주세요.')); };
  });
  return connection;
}
const resultOf = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const finished = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('저장이 취소되었습니다.')); tx.onerror = () => {}; });
export async function allSermons() {
  const db = await openDB();
  return resultOf(db.transaction('sermons').objectStore('sermons').getAll());
}
export async function getSermon(id) {
  const db = await openDB();
  return resultOf(db.transaction('sermons').objectStore('sermons').get(id));
}
export async function saveSermon(value) {
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) throw new Error('제목을 1~200자로 입력해 주세요.');
  if ((value.body || '').length > 200000) throw new Error('본문은 20만 자 이내로 입력해 주세요.');
  const db = await openDB(), tx = db.transaction('sermons', 'readwrite'), done = finished(tx);
  const request = tx.objectStore('sermons').put(value);
  let id;
  request.onsuccess = () => { id = request.result; };
  await done;
  return id;
}
export async function makeBackup() {
  const db = await openDB(), tx = db.transaction(['sermons', 'documents']), done = finished(tx);
  const sermons = resultOf(tx.objectStore('sermons').getAll());
  const documents = resultOf(tx.objectStore('documents').getAll());
  const records = await Promise.all([sermons, documents]);
  await done;
  return { app: 'min-sermon-library', schemaVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(), sermons: records[0], documents: records[1] };
}
function isRecord(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function validId(x) { return Number.isSafeInteger(x) && x > 0; }
export function validateBackup(value) {
  if (!isRecord(value) || value.app !== 'min-sermon-library' || value.schemaVersion !== BACKUP_VERSION || !Array.isArray(value.sermons) || !Array.isArray(value.documents)) throw new Error('지원하는 설교서재 백업 파일이 아닙니다.');
  if (value.sermons.length > 10000 || value.documents.length > 20000) throw new Error('한 번에 복원할 수 있는 자료 수를 초과했습니다.');
  const ids = new Set(), docIds = new Set();
  for (const s of value.sermons) {
    if (!isRecord(s) || !validId(s.id) || ids.has(s.id) || typeof s.title !== 'string' || !s.title.trim() || s.title.length > 200) throw new Error('설교 제목 또는 식별자가 올바르지 않습니다.');
    ids.add(s.id);
    for (const [key, limit] of Object.entries({ body: 200000, date: 100, status: 100, scripture: 300, audience: 100, createdAt: 100, updatedAt: 100, deletedAt: 100 })) {
      if (s[key] !== undefined && (typeof s[key] !== 'string' || s[key].length > limit)) throw new Error('설교 필드 형식이 올바르지 않습니다: ' + key);
    }
    if (s.tags !== undefined && (!Array.isArray(s.tags) || s.tags.length > 30 || s.tags.some(t => typeof t !== 'string' || t.length > 100))) throw new Error('태그 형식이 올바르지 않습니다.');
  }
  for (const d of value.documents) {
    if (!isRecord(d) || !validId(d.id) || docIds.has(d.id) || !validId(d.sermonId) || !ids.has(d.sermonId) || typeof d.title !== 'string') throw new Error('첨부 자료의 설교 연결이 올바르지 않습니다.');
    docIds.add(d.id);
  }
  return value;
}
// Add-only restore. Keys and document relationships are remapped atomically.
export async function restoreBackup(input) {
  const value = validateBackup(input), db = await openDB();
  const tx = db.transaction(['sermons', 'documents'], 'readwrite'), done = finished(tx), mapping = new Map();
  let remaining = value.sermons.length;
  const addDocuments = () => {
    for (const d of value.documents) {
      const copy = structuredClone(d); delete copy.id; copy.sermonId = mapping.get(d.sermonId);
      tx.objectStore('documents').add(copy);
    }
  };
  if (!remaining) addDocuments();
  for (const s of value.sermons) {
    const copy = structuredClone(s); delete copy.id;
    const r = tx.objectStore('sermons').add(copy);
    r.onsuccess = () => { mapping.set(s.id, r.result); if (--remaining === 0) addDocuments(); };
  }
  await done;
  return value.sermons.length;
}
export function matches(s, query = '', status = '', audience = '', scripture = '', tag = '') {
  const normalize = x => String(x || '').normalize('NFKC').toLocaleLowerCase('ko');
  const tags = Array.isArray(s.tags) ? s.tags : [];
  const text = normalize([s.title, s.body, s.scripture, s.audience, ...tags].join(' '));
  return normalize(query).trim().split(/\s+/).every(word => text.includes(word)) && (!status || s.status === status) && (!audience || s.audience === audience) && normalize(s.scripture).includes(normalize(scripture)) && normalize(tags.join(' ')).includes(normalize(tag));
}
export function newest(a, b) { return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || b.id - a.id; }
