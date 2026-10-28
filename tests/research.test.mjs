import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blankResearch,validateResearch,approvalProblems,gaps,invalidate,handoff,buildPrompt,buildSermonPrompt,QA,SECTIONS} from '../research.js';
const source=()=>({id:'s1',title:'제공한 본문',kind:'primary',status:'read',access:'direct',locator:'',note:''});
test('a registered or secondary citation cannot masquerade as verified',()=>{
 const r=blankResearch();r.sources=[{...source(),status:'verified',access:'indirect',locator:'p.1',note:'재인용'}];assert.throws(()=>validateResearch(r),/원문 대조/);
 r.sources=[{...source(),status:'verified',locator:'',note:'확인'}];assert.throws(()=>validateResearch(r),/위치/);
 r.sources=[source()];assert(validateResearch(r));assert(gaps(r).some(x=>x.label.includes('원문 확인')));
});
test('approval cannot be inferred from QA; content edits invalidate QA',()=>{
 const r=blankResearch();for(const key of Object.keys(QA))r.qa[key]={status:'PASS',reviewer:'목회자',note:'검토 기록'};
 assert.equal(r.approval.state,'DRAFT');assert(approvalProblems(r).length);
 r.approval={state:'APPROVED',by:'목회자',at:new Date().toISOString()};assert.throws(()=>validateResearch(r));
 invalidate(r);assert.equal(r.approval.state,'DRAFT');assert.deepEqual(r.qa,{});
});
test('complete manual research can be separately approved, and handoff preserves limitations',()=>{
 const r=blankResearch();for(const [k]of SECTIONS)r.fields[k]='검토한 연구 기록';r.sources=[{...source(),status:'verified',locator:'본문 1절',note:'사용자가 원문 대조'}];for(const k of Object.keys(QA))r.qa[k]={status:'PASS',reviewer:'검토자',note:'확인 기록'};
 assert.deepEqual(approvalProblems(r),[]);r.approval={state:'APPROVED',by:'검토자',at:new Date().toISOString()};assert(validateResearch(r));
 const out=handoff({title:'설교',scripture:'갈1:1~5'},r);assert.equal(out.research.fields.limitations,'검토한 연구 기록');assert.equal(out.research.sources[0].locator,'본문 1절');
});
test('claims preserve evidence types and source integrity; BICS has an explicit prerequisite',()=>{
 const r=blankResearch();r.claims=[{id:'c',text:'가설',type:'hypothesis',confidence:'low',sourceIds:['missing']}];assert.throws(()=>validateResearch(r),/연결/);r.claims=[];assert.throws(()=>buildPrompt({scripture:'갈1장'},r,'BICS'),/종합 해석/);
 assert.throws(()=>buildSermonPrompt({scripture:'갈1장'},r),/종합 해석/);
 r.fields.theology='본문의 종합 해석';assert.match(buildSermonPrompt({scripture:'갈1장'},r),/재인용/);assert.match(buildPrompt({scripture:'갈1장'},r,'BICS'),/별도로/);
 r.filters.A05={required:true,status:'unverified',note:''};assert(gaps(r).some(x=>x.reason.includes('미확인')));
});
