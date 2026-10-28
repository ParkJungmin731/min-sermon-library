import {chromium} from 'playwright';
import {createApp} from '../server.mjs';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const app=createApp({env:{}});await new Promise(r=>app.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--disable-gpu']}: {})});
try{
 const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+app.address().port);await page.getByRole('button',{name:'+ 새 설교',exact:true}).click();await page.getByLabel('설교 제목',{exact:true}).fill('갈라디아서 연구');await page.getByLabel('성경 본문',{exact:true}).fill('갈라디아서 1:1–5');await page.getByLabel('설교 본문',{exact:true}).fill('기존 원고를 보존합니다.');await page.getByRole('button',{name:'저장하기',exact:true}).click();await page.getByText(/저장 완료 ·/).waitFor();
 await page.getByRole('button',{name:'본문 연구실',exact:true}).click();await page.getByRole('heading',{name:'본문 연구실',exact:true}).waitFor();
 await page.getByLabel('연구 범위 · 본문 관찰',{exact:true}).fill('갈라디아서 서두의 사도권과 복음');
 await page.getByRole('button',{name:'연구 저장',exact:true}).click();await page.getByText('연구 저장 완료',{exact:true}).waitFor();
 await page.getByRole('button',{name:'출처 · 자료',exact:true}).click();
 const upload=page.getByLabel('개인 연구 자료 가져오기 (HTML · TXT · MD · PDF, 파일당 5MB)');
 // A synthetic LRC sample is always available; actual supplied attachments are optional.
 const args=process.argv.slice(2);let html;
 if(args[0])html=readFileSync(args[0]);else html=Buffer.from('<h1>안전한 예시</h1><div class="intro"><table><tr><td>저자</td><td>주석</td><td>p.1</td><td>source.md</td></tr></table></div><div id="sec-2"><div class="section-content">보고서의 개요</div></div><div id="sec-7"><div class="section-content">경쟁 해석 비교</div></div><script>window.hacked=true</script><img src="https://evil.invalid/tracker">');
 let evilRequests=0;await page.route('https://evil.invalid/**',route=>{evilRequests++;route.abort();});
 await upload.setInputFiles({name:'LRC.html',mimeType:'text/html',buffer:html});await page.getByText(/1개 자료를 이 브라우저에 저장/).waitFor();
 await page.locator('.research-section').filter({has:page.getByRole('button',{name:'LRC 항목을 빈 연구칸에 채우기',exact:true,includeHidden:true})}).locator('summary').click();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'LRC 항목을 빈 연구칸에 채우기',exact:true}).click();await page.getByText(/개 빈 연구 항목을 채웠습니다/).waitFor();
 await page.getByLabel('보관 자료 검색',{exact:true}).fill('결과가없는자료검색어');assert.equal(await page.locator('.research-section:not([hidden])').filter({has:page.getByRole('button',{name:'LRC 항목을 빈 연구칸에 채우기',includeHidden:true})}).count(),0);await page.getByLabel('보관 자료 검색',{exact:true}).fill('');
 assert.equal(await page.evaluate(()=>window.hacked),undefined);assert.equal(evilRequests,0);
 await page.getByRole('button',{name:'연구 저장',exact:true}).click();await page.getByText('연구 저장 완료',{exact:true}).waitFor();
 const saved=await page.evaluate(async()=>{const{allSermons}=await import('./data.js');return(await allSermons())[0];});
 assert.equal(saved.body,'기존 원고를 보존합니다.');assert(saved.research.fields.overview);assert(saved.research.sources.every(s=>s.status==='registered'&&s.access==='indirect'));assert.equal(saved.research.approval.state,'DRAFT');
 if(args[0]){assert.equal(saved.research.sources.length,13);assert.match(saved.research.fields.words,/ἀπόστολος/);assert.equal(Object.keys(saved.research.fields).length,10);}
 if(args[1]){await upload.setInputFiles(args.slice(1));await page.getByText(new RegExp(args.length-1+'개 자료를 이 브라우저에 저장')).waitFor();assert.equal(await page.getByRole('button',{name:'PDF 다운로드',exact:true,includeHidden:true}).count(),args.length-1);}
 await page.getByRole('button',{name:'검수 · 승인',exact:true}).click();await page.getByRole('button',{name:'검토 후 대표본 승인',exact:true}).click();await page.getByText(/승인 전 보완 필요/).waitFor();
 await page.getByLabel('본문 · 문맥 판정',{exact:true}).selectOption('PASS');await page.getByLabel('본문 · 문맥 검토자',{exact:true}).fill('검토자');await page.getByLabel('본문 · 문맥 검토 메모',{exact:true}).fill('본문의 범위 확인');await page.getByRole('button',{name:'연구 저장',exact:true}).click();await page.getByText('연구 저장 완료',{exact:true}).waitFor();
 await page.getByRole('button',{name:'연구 기록',exact:true}).click();await page.getByLabel('개요 · 핵심 메시지',{exact:true}).fill('수정된 연구 개요');
 await page.getByRole('button',{name:'검수 · 승인',exact:true}).click();assert.equal(await page.getByLabel('본문 · 문맥 판정',{exact:true}).inputValue(),'UNCHECKED');
 await page.getByRole('button',{name:'보완 · 인계',exact:true}).click();await page.getByLabel('추가할 후속 작업',{exact:true}).fill('주석 원문 확인');await page.getByRole('button',{name:'작업 추가',exact:true}).click();await page.getByRole('button',{name:'연구 저장',exact:true}).click();await page.getByText('연구 저장 완료',{exact:true}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'연구 인계 JSON 내보내기',exact:true}).click();const file=await download;const out=JSON.parse(readFileSync(await file.path(),'utf8'));assert(out.openIssues.length);assert.equal(out.research.tasks[0].done,false);assert.equal(out.research.approval.state,'DRAFT');
 await page.reload();await page.locator('nav [data-page=research]').click();await page.locator('.cards').getByRole('button',{name:'본문 연구',exact:true}).click();await page.getByRole('heading',{name:'본문 연구실',exact:true}).waitFor();assert.equal(await page.getByLabel('개요 · 핵심 메시지',{exact:true}).inputValue(),'수정된 연구 개요');
 await page.locator('summary').filter({hasText:'신학적 의미 · 종합'}).click();await page.getByLabel('신학적 의미 · 종합',{exact:true}).fill('본문의 복음과 은혜를 종합합니다.');await page.getByRole('button',{name:'연구 저장',exact:true}).click();await page.getByText('연구 저장 완료',{exact:true}).waitFor();
 await page.getByRole('button',{name:'보완 · 인계',exact:true}).click();const sermonRequest=page.waitForEvent('download');await page.getByRole('button',{name:'설교 작성 요청문 다운로드',exact:true}).click();const requestFile=await sermonRequest;assert.match(readFileSync(await requestFile.path(),'utf8'),/미검증/);await page.getByRole('button',{name:'연구 기록',exact:true}).click();
 await page.setViewportSize({width:375,height:812});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/research-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/research-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({researchBrowser:'passed',actualLRC:Boolean(args[0]),sources:saved.research.sources.length,actualPDFs:Math.max(0,args.length-1),checks:['script/resource inert import','LRC field mapping','unverified secondary sources','manuscript preserved','QA invalidation','approval gate','task and handoff','reload persistence','375px layout']}));await context.close();
}finally{await browser.close();await new Promise(r=>app.close(r));}
