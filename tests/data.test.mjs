import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBObjectStore } from 'fake-indexeddb';
globalThis.indexedDB = indexedDB;
// Seed the actual old Dexie native schema/version, not a simplified object stub.
await new Promise((resolve, reject) => {
  const r = indexedDB.open('SermonDB', 10);
  r.onupgradeneeded = () => {
    const s = r.result.createObjectStore('sermons', { keyPath: 'id', autoIncrement: true });
    for (const k of ['title', 'date', 'status']) s.createIndex(k, k);
    const d = r.result.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
    for (const k of ['sermonId', 'title']) d.createIndex(k, k);
    s.add({ id: 7, title: '기존 설교', date: '2026. 10. 9.', status: 'Idea', legacy: '그대로 보존' });
    d.add({ id: 3, sermonId: 7, title: '기존 문서', custom: { body: '원문' } });
  };
  r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = () => reject(r.error);
});
const { openDB, allSermons, getSermon, saveSermon, makeBackup, restoreBackup } = await import('../data.js');
test('legacy native v10 remains unchanged and editing preserves fields', async () => {
  assert.equal((await openDB()).version, 10);
  const old = await getSermon(7); assert.equal(old.date, '2026. 10. 9.');
  await saveSermon({ ...old, body: '새 본문', scripture: '골3:15' });
  assert.equal((await getSermon(7)).legacy, '그대로 보존'); assert.equal((await allSermons()).length, 1);
});
test('backup and restore add 10 records without overwriting; documents remap', async () => {
  const before = await makeBackup(); const sermons = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, title: '복원 설교 ' + i, body: '본문 ' + i, status: 'Writing', tags: ['감사'] }));
  const data = { ...before, sermons, documents: [{ id: 1, sermonId: 1, title: '연결 자료', content: '원문' }] };
  assert.equal(await restoreBackup(data), 10);
  const after = await makeBackup(); assert.equal(after.sermons.length, 11); assert.equal(after.documents.length, 2);
  assert.deepEqual(after.sermons.find(s => s.id === 7), before.sermons.find(s => s.id === 7));
  for (const original of sermons) { const restored = after.sermons.find(s => s.title === original.title); assert(restored); const { id, ...fields } = restored; const { id: oldId, ...expected } = original; assert.deepEqual(fields, expected); }
  const linked = after.documents.find(d => d.title === '연결 자료'); assert.equal(after.sermons.find(s => s.id === linked.sermonId).title, '복원 설교 0');
});
test('document write failure rolls back added sermons too', async () => {
  const before = await makeBackup(), originalAdd = IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add = function(value, ...rest) { if (this.name === 'documents') return originalAdd.call(this, { ...value, id: 3 }, ...rest); return originalAdd.call(this, value, ...rest); };
  try { await assert.rejects(restoreBackup({ ...before, sermons: [{ id: 1, title: '저장되면 안 됨' }], documents: [{ id: 1, sermonId: 1, title: '의도적 충돌' }] })); }
  finally { IDBObjectStore.prototype.add = originalAdd; }
  const after = await makeBackup(); assert.deepEqual(after.sermons, before.sermons); assert.deepEqual(after.documents, before.documents);
});
test('research and attachments survive add-only restore and conflicts are rejected',async()=>{
 const {blankResearch}=await import('../research.js');const {saveResearch,saveDocument,documentsFor}=await import('../data.js');
 const id=await saveSermon({title:'연구 설교',body:'기존 설교 원고'});const r=blankResearch();r.fields.overview='연구 요약';
 const stored=await saveResearch(id,r,0);assert.equal(stored.revision,1);await assert.rejects(saveResearch(id,r,0),/다른 탭/);
 await saveDocument({sermonId:id,title:'연구보고서',text:'원문 텍스트',imported:{fields:{overview:'추출 요약'},sources:[]}});
 await saveDocument({sermonId:id,title:'PDF 가이드',attachment:{filename:'guide.pdf',mime:'application/pdf',data:'data:application/pdf;base64,JVBERi0xLjQ='}});
 // A stale manuscript editor may not erase newer research.
 await saveSermon({id,title:'연구 설교',body:'수정된 설교 원고'});assert.equal((await getSermon(id)).research.fields.overview,'연구 요약');
 const all=await makeBackup(),subset={...all,sermons:all.sermons.filter(s=>s.id===id),documents:all.documents.filter(d=>d.sermonId===id)};
 await restoreBackup(subset);const restored=(await allSermons()).filter(s=>s.title==='연구 설교').sort((a,b)=>b.id-a.id)[0];assert.notEqual(restored.id,id);assert.equal(restored.research.fields.overview,'연구 요약');assert.equal((await documentsFor(restored.id)).length,2);assert.equal(restored.body,'수정된 설교 원고');
});
test('removing an attachment is scoped to its sermon and preserves manuscript and research',async()=>{
 const {deleteDocument,documentsFor,saveDocument}=await import('../data.js');
 const s=(await allSermons()).find(s=>s.research);const id=await saveDocument({sermonId:s.id,title:'삭제 테스트',text:'개인 자료'});
 await assert.rejects(deleteDocument(id,s.id+9999));assert((await documentsFor(s.id)).some(d=>d.id===id));
 await deleteDocument(id,s.id);assert(!(await documentsFor(s.id)).some(d=>d.id===id));assert.deepEqual((await getSermon(s.id)).research,s.research);
});
