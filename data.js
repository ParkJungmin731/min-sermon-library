import { validateResearch, blankResearch } from './research.js';
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
  if (value.research !== undefined) validateResearch(value.research);
  if ((value.body || '').length > 200000) throw new Error('본문은 20만 자 이내로 입력해 주세요.');
  const db = await openDB(), tx = db.transaction('sermons', 'readwrite'), done = finished(tx);
  let id;
  const put = existing => {
    // The manuscript editor must not overwrite a newer research workspace from another tab.
    const record = existing?.research ? { ...value, research: existing.research } : value;
    const request = tx.objectStore('sermons').put(record);
    request.onsuccess = () => { id = request.result; };
  };
  if (value.id) { const current = tx.objectStore('sermons').get(value.id); current.onsuccess = () => put(current.result); }
  else put();
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
    if (s.research !== undefined) validateResearch(s.research);
    for (const [key, limit] of Object.entries({ body: 200000, date: 100, status: 100, scripture: 300, audience: 100, createdAt: 100, updatedAt: 100, deletedAt: 100 })) {
      if (s[key] !== undefined && (typeof s[key] !== 'string' || s[key].length > limit)) throw new Error('설교 필드 형식이 올바르지 않습니다: ' + key);
    }
    if (s.tags !== undefined && (!Array.isArray(s.tags) || s.tags.length > 30 || s.tags.some(t => typeof t !== 'string' || t.length > 100))) throw new Error('태그 형식이 올바르지 않습니다.');
  }
  for (const d of value.documents) {
    if (!isRecord(d) || !validId(d.id) || docIds.has(d.id) || !validId(d.sermonId) || !ids.has(d.sermonId) || typeof d.title !== 'string') throw new Error('첨부 자료의 설교 연결이 올바르지 않습니다.');
    docIds.add(d.id);
    validateDocument(d);
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
  const research=s.research||{};
  const text = normalize([s.title, s.body, s.scripture, s.audience, ...tags, ...Object.values(research.fields||{}), ...(research.sources||[]).flatMap(x=>[x.title,x.author]), ...(research.claims||[]).map(x=>x.text)].join(' '));
  return normalize(query).trim().split(/\s+/).every(word => text.includes(word)) && (!status || s.status === status) && (!audience || s.audience === audience) && normalize(s.scripture).includes(normalize(scripture)) && normalize(tags.join(' ')).includes(normalize(tag));
}
export function newest(a, b) { return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || b.id - a.id; }

export async function documentsFor(sermonId) {
 const db=await openDB();const rows=await resultOf(db.transaction('documents').objectStore('documents').getAll());
 return rows.filter(d=>d.sermonId===sermonId);
}
export function validateDocument(d){
 if(typeof d.title!=='string'||!d.title.trim()||d.title.length>300)throw new Error('자료 제목을 1~300자로 입력해 주세요.');
 if(d.text!==undefined&&(typeof d.text!=='string'||d.text.length>250000))throw new Error('자료 본문은 25만 자 이내로 입력해 주세요.');
 if(d.imported!==undefined){if(!d.imported||typeof d.imported!=='object')throw new Error('가져온 연구 형식을 확인해 주세요.');validateResearch({...blankResearch(),fields:d.imported.fields,sources:d.imported.sources});}
 if(d.attachment!==undefined){
  const a=d.attachment;
  if(!a||typeof a.filename!=='string'||a.filename.length>300||a.mime!=='application/pdf'||typeof a.data!=='string'||a.data.length>7100000||!/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(a.data))throw new Error('PDF 첨부 형식을 확인해 주세요.');
 }
 return d;
}
export async function saveDocument(d){
 validateDocument(d);const db=await openDB(),tx=db.transaction(['sermons','documents'],'readwrite'),done=finished(tx);
 let id;const parent=tx.objectStore('sermons').get(d.sermonId);
 parent.onsuccess=()=>{if(!parent.result){tx.abort();return;}const request=tx.objectStore('documents').put(d);request.onsuccess=()=>{id=request.result;};};
 await done;return id;
}
export async function saveResearch(sermonId,research,expectedRevision=0){
 validateResearch(research);const db=await openDB(),tx=db.transaction('sermons','readwrite'),done=finished(tx);let issue;
 const request=tx.objectStore('sermons').get(sermonId);
 request.onsuccess=()=>{
  const existing=request.result;
  if(!existing){issue='설교를 먼저 저장해 주세요.';tx.abort();return;}
  if((existing.research?.revision||0)!==expectedRevision){issue='다른 탭에서 연구 기록이 변경되었습니다. 입력을 내보내 보관한 후 다시 열어 주세요.';tx.abort();return;}
  tx.objectStore('sermons').put({...existing,research:{...research,revision:expectedRevision+1},updatedAt:new Date().toISOString()});
 };
 try{await done;}catch(err){throw issue?new Error(issue):err;}
 return {...research,revision:expectedRevision+1};
}
export async function deleteDocument(id,sermonId){
 const db=await openDB(),tx=db.transaction('documents','readwrite'),done=finished(tx),store=tx.objectStore('documents'),request=store.get(id);
 request.onsuccess=()=>{if(!request.result||request.result.sermonId!==sermonId){tx.abort();return;}store.delete(id);};
 await done;
}
