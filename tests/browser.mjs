import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const app = createApp({ env: {} }); await new Promise(r => app.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + app.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'] } : {}) });
try {
 const context = await browser.newContext({ acceptDownloads: true }), page = await context.newPage(), errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.goto(base); await page.waitForFunction(() => document.querySelector('h1')?.textContent === '나의 사역 기록');
 // Install a real legacy Dexie native-v10 database and key, then reload the new app.
 await page.evaluate(async () => {
   const { openDB } = await import('/data.js'); (await openDB()).close();
   await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase('SermonDB'); r.onsuccess = resolve; r.onerror = reject; });
   await new Promise((resolve, reject) => { const r = indexedDB.open('SermonDB', 10); r.onupgradeneeded = () => { const s = r.result.createObjectStore('sermons', { keyPath: 'id', autoIncrement: true }); for (const k of ['title','date','status']) s.createIndex(k,k); const d = r.result.createObjectStore('documents', { keyPath: 'id', autoIncrement: true }); for(const k of ['sermonId','title']) d.createIndex(k,k); s.add({id:7,title:'기존 설교',date:'2026. 10. 9.',status:'Idea'}); d.add({id:3,sermonId:7,title:'연결 자료',body:'원문'}); };r.onsuccess=()=>{r.result.close();resolve();};r.onerror=reject; });
   localStorage.setItem('ai_api_key', 'fake-browser-test-key');
 });
 await page.reload(); await page.getByText('기존 설교', { exact: true }).waitFor();
 assert.equal(await page.evaluate(() => localStorage.getItem('ai_api_key')), null);
 assert.equal(await page.evaluate(async () => { const {openDB}=await import('/data.js'); return (await openDB()).version; }), 10);
 await page.getByRole('button', {name:'내 설교', exact:true}).click();await page.getByRole('button',{name:'열기 · 편집'}).click();
 await page.getByLabel('설교 제목', {exact:true}).fill('<img src=x onerror=alert(1)> 감사');
 await page.getByLabel('성경 본문', {exact:true}).fill('골로새서 3:15~17');await page.getByLabel('청중', {exact:true}).fill('장년');
 await page.getByLabel('태그 (쉼표로 구분)').fill('감사, 은혜');await page.getByLabel('진행 상태').selectOption('Writing');await page.getByLabel('설교 본문', {exact:true}).fill('하나님의 평강을 따라 살아갑니다.\n은혜를 기억합니다.');
 await page.getByRole('button',{name:'저장하기',exact:true}).click();await page.getByText(/저장 완료 ·/).waitFor();
 await page.reload();await page.getByRole('button',{name:'내 설교',exact:true}).click();await page.getByLabel('통합 검색').fill('평강');await page.getByText('<img src=x onerror=alert(1)> 감사',{exact:true}).waitFor();assert.equal(await page.locator('article img').count(),0);
 await page.getByLabel('상태',{exact:true}).selectOption('Complete');assert.equal(await page.locator('article').count(),0);await page.getByLabel('상태',{exact:true}).selectOption('Writing');await page.getByLabel('성경 본문',{exact:true}).fill('골로새서');assert.equal(await page.locator('article').count(),1);
 await page.getByRole('button',{name:'열기 · 편집'}).click();assert.match(await page.getByLabel('설교 본문',{exact:true}).inputValue(),/평강/);
 // Unsaved changes guard.
 await page.getByLabel('설교 본문',{exact:true}).fill('저장하지 않은 변경');page.once('dialog', d=>d.dismiss());await page.getByRole('button',{name:'대시보드',exact:true}).click();assert.equal(await page.getByLabel('설교 본문',{exact:true}).inputValue(),'저장하지 않은 변경');
 page.once('dialog', d=>d.accept());await page.getByRole('button',{name:'대시보드',exact:true}).click();
 await page.getByRole('button',{name:'백업 · 설정',exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'전체 백업 다운로드'}).click();const dl=await downloadPromise;const backup=JSON.parse(readFileSync(await dl.path(),'utf8'));assert.equal(backup.sermons.length,1);assert.equal(backup.documents.length,1);
 await page.getByLabel('복원할 백업 파일 (최대 20MB)').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.getByRole('button',{name:'확인 · 새 자료로 복원'}).waitFor();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'확인 · 새 자료로 복원'}).click();await page.getByText('1편을 복원했습니다. 내 설교에서 확인해 주세요.').waitFor();
 const restored=await page.evaluate(async()=>{const {makeBackup}=await import('/data.js');return makeBackup();});assert.equal(restored.sermons.length,2);assert.equal(restored.documents.length,2);assert.notEqual(restored.documents[0].sermonId,restored.documents[1].sermonId);
 await page.getByRole('button',{name:'내 설교',exact:true}).click();await page.getByRole('button',{name:'열기 · 편집'}).first().click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'휴지통으로'}).click();await page.getByLabel('휴지통 보기').check();await page.getByRole('button',{name:'설교 복구'}).click();await page.getByText('<img src=x onerror=alert(1)> 감사',{exact:true}).first().waitFor();
 await page.getByRole('button',{name:'AI 초안',exact:true}).click();await page.getByText(/AI 서버가 아직 연결되지/).waitFor();assert(await page.getByRole('button',{name:'AI 초안 생성',exact:true}).isDisabled());
 await page.setViewportSize({width:375,height:812});await page.getByRole('button',{name:'대시보드',exact:true}).click();await page.getByText('최근 작업',{exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/desktop.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('Browser checks passed: real IndexedDB v10 preservation, key removal, edit/save/reload, XSS display, filters, unsaved guard, download/restore remapping, trash recovery, static AI state, 375px overflow, no page errors.');
 await context.close();
 const aiContext = await browser.newContext(), aiPage = await aiContext.newPage();
 await aiPage.route('**/api/status', route => route.fulfill({json:{ready:true}}));
 let fail = false;
 await aiPage.route('**/api/generate', route => route.fulfill({status:fail?502:200,json:fail?{error:'의도한 서버 실패'}:{title:'검토할 AI 설교',body:'<b>실행되지 않는 초안</b>\n본문 검토 필요',meta:{model:'mock',promptVersion:'test'}}}));
 await aiPage.goto(base);await aiPage.getByRole('button',{name:'AI 초안',exact:true}).click();
 await aiPage.getByLabel('성경 본문',{exact:true}).fill('골3:15~17');await aiPage.getByLabel('설교 의도').fill('감사 회복');
 await aiPage.getByRole('checkbox').check();await aiPage.getByRole('button',{name:'AI 초안 생성',exact:true}).click();
 await aiPage.getByText('검토할 초안',{exact:true}).waitFor();assert.equal(await aiPage.locator('.preview b').count(),0);
 await aiPage.getByRole('button',{name:'검토용 초안으로 별도 저장',exact:true}).click();await aiPage.getByRole('button',{name:'별도 초안 저장 완료'}).waitFor();
 let aiRows=await aiPage.evaluate(async()=>{const {allSermons}=await import('/data.js');return allSermons();});assert.equal(aiRows.length,1);assert.equal(aiRows[0].kind,'ai-draft');assert.equal(aiRows[0].status,'Idea');
 fail=true;await aiPage.getByRole('button',{name:'AI 초안 생성',exact:true}).click();await aiPage.getByText('의도한 서버 실패',{exact:true}).waitFor();assert.equal(await aiPage.getByLabel('설교 의도').inputValue(),'감사 회복');assert.match(await aiPage.locator('.preview').textContent(),/초안/);
 aiRows=await aiPage.evaluate(async()=>{const {allSermons}=await import('/data.js');return allSermons();});assert.equal(aiRows.length,1);
 console.log('AI browser checks passed: consented generation, safe text display, separate Idea draft storage, failure preserves inputs and prior draft.');
 await aiContext.close();
} finally { await browser.close(); await new Promise(r=>app.close(r)); }
