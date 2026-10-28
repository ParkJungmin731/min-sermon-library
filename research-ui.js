import { saveResearch, documentsFor, saveDocument, deleteDocument } from './data.js';
import { SECTIONS, QA, CHECK_STATUS, SOURCE_STATUS, SOURCE_KINDS, FILTERS, blankResearch, validateResearch, invalidate, gaps, approvalProblems, handoff, researchMarkdown, buildPrompt, buildSermonPrompt, parseResearchHTML } from './research.js';
const h=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let fieldId=0;
function field(label,value='',kind='input',options=[]){const box=h('div',undefined,'field'),el=h(kind),caption=h('label',label);el.id='research-field-'+(++fieldId);caption.htmlFor=el.id;box.append(caption);if(kind==='select')for(const [key,name]of options){const o=h('option',name);o.value=key;el.append(o);}el.value=value;box.append(el);return{box,el};}
function output(name,body,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([body],{type})),a=h('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function readDataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('PDF 파일을 읽지 못했습니다.'));reader.readAsDataURL(file);});}
export async function mountResearch({root,sermon,onDirty,onBusy,onMessage,onError,onExit}){
 let speechSession=0;
 let r=structuredClone(sermon.research||blankResearch()),busy=false,documents=await documentsFor(sermon.id),tab='notes';
 const button=(label,fn,cls='')=>{const b=h('button',label,cls);b.type='button';b.addEventListener('click',()=>Promise.resolve().then(fn).catch(onError));return b;};
 const progress=h('p','','subtle'),approval=h('p','','help'),status=h('span','연구 내용을 입력한 후 저장해 주세요.','save-status');status.textContent=sermon.research?'저장된 연구 기록':'연구 내용을 입력한 후 저장해 주세요.';status.setAttribute('role','status');
 const toolbar=h('div',undefined,'research-toolbar'),tabs=h('div',undefined,'research-tabs'),containers={};
 function changed(reset=true){invalidate(r,reset);onDirty(true);status.textContent='저장하지 않은 연구 변경';updateProgress();}
 function updateProgress(){progress.textContent=`연구 기록 ${SECTIONS.filter(([key])=>r.fields[key]?.trim()).length}/${SECTIONS.length} · 출처 ${r.sources.length}개 · 검수 통과 ${Object.keys(QA).filter(k=>r.qa[k]?.status==='PASS').length}/6`;
  approval.textContent=r.approval.state==='APPROVED'?`대표본 승인 · ${r.approval.by} · ${new Date(r.approval.at).toLocaleString('ko-KR')}`:'작업본 · 검수 판정과 대표본 승인은 별도입니다. 이 양식은 전문 엔진이나 사전을 자동 실행하지 않습니다.';
  renderGaps();renderQA();
 }
 async function save(){if(busy)return;busy=true;onBusy(true);status.textContent='저장 중…';saveButton.disabled=true;
  try{const snapshot=structuredClone(r),before=JSON.stringify(snapshot);const stored=await saveResearch(sermon.id,snapshot,r.revision);const edited=JSON.stringify(r)!==before;r.revision=stored.revision;onDirty(edited);status.textContent=edited?'저장 후 변경 사항이 있습니다':'연구 저장 완료';onMessage('연구 기록·출처·검수·후속 작업을 저장했습니다.');updateProgress();}
  catch(err){status.textContent='저장 실패 · 입력 내용을 유지했습니다';throw err;}
  finally{busy=false;onBusy(false);saveButton.disabled=false;}
 }
 const saveButton=button('연구 저장',save,'primary');
 toolbar.append(saveButton,button('설교 원고로 돌아가기',()=>onExit(sermon.id)),status);
 const title=h('div',undefined,'heading');title.append(h('div'));title.firstChild.append(h('p','BIBLICAL RESEARCH','eyebrow'),h('h1','본문 연구실'),h('p',`${sermon.title} · ${sermon.scripture||'성경 본문은 설교 편집에서 입력하세요.'}`,'subtle'));
 for(const [key,label]of [['notes','연구 기록'],['sources','출처 · 자료'],['qa','검수 · 승인'],['handoff','보완 · 인계']]){const b=button(label,()=>{tab=key;showTab();});b.dataset.researchTab=key;tabs.append(b);containers[key]=h('section');}
 function showTab(){for(const [key,panel]of Object.entries(containers))panel.hidden=key!==tab;for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.researchTab===tab));if(tab==='qa')renderQA();if(tab==='handoff')renderGaps();}
 const mode=field('연구 방식',r.mode,'select',[['WORBS','WORBS · 본문 주해'],['BICS','BICS · 별도 목회 적용']]),depth=field('연구 깊이',r.depth,'select',[['BRIEF','BRIEF · 간략'],['CORE','CORE · 기본'],['FULL','FULL · 심층']]);
 mode.el.onchange=()=>{r.mode=mode.el.value;changed(false);};depth.el.onchange=()=>{r.depth=depth.el.value;changed(false);};
 const options=h('div',undefined,'form-grid');options.append(mode.box,depth.box);containers.notes.append(options,h('p','먼저 본문 연구를 작성하고 적용 연구는 따로 진행합니다. 아래 항목 작성률은 연구의 정확성이나 자동 검수 결과가 아닙니다.','help'));
 const fieldInputs={};
 for(const [key,label,hint]of SECTIONS){const details=h('details',undefined,'research-section'),input=field(label,r.fields[key]||'','textarea');input.el.maxLength=100000;input.el.rows=7;input.el.placeholder=hint;input.el.oninput=()=>{r.fields[key]=input.el.value;changed();};fieldInputs[key]=input.el;details.open=['scope','overview'].includes(key);details.append(h('summary',label),h('p',hint,'subtle'),input.box);containers.notes.append(details);}
 const sourceList=h('div'),claimList=h('div'),docList=h('div'),docSearch=field('보관 자료 검색');docSearch.el.placeholder='자료 제목 또는 본문';docSearch.el.oninput=()=>{const query=docSearch.el.value.normalize('NFKC').toLocaleLowerCase('ko');for(const card of docList.children)card.hidden=!card.dataset.search.includes(query);};
 containers.sources.append(h('h2','자료 보관함'),h('p','선택한 파일은 이 브라우저에만 저장됩니다. HTML은 코드 실행 없이 텍스트로 가져오고, PDF는 원본 파일로 보관합니다. PDF 본문을 자동 추출하거나 사전을 연결하지 않습니다.','subtle'));
 const upload=field('개인 연구 자료 가져오기 (HTML · TXT · MD · PDF, 파일당 5MB)');upload.el.type='file';upload.el.multiple=true;upload.el.accept='.html,.htm,.txt,.md,.pdf';containers.sources.append(upload.box,docSearch.box,docList,h('hr',undefined,'divider'),h('h2','출처와 열람 기록'),h('p','등록·열람·원문 대조 확인을 구분합니다. 보고서의 자기 점검 표시를 원문 확인의 증거로 자동 인정하지 않습니다.','subtle'));
 containers.sources.append(button('+ 출처 추가',()=>{r.sources.push({id:crypto.randomUUID(),title:'',kind:'commentary',status:'registered',access:'direct',author:'',locator:'',note:'',via:''});changed();renderSources();}),sourceList,h('hr',undefined,'divider'),h('h2','주장과 근거'),button('+ 주장 추가',()=>{r.claims.push({id:crypto.randomUUID(),text:'',type:'interpretation',confidence:'medium',sourceIds:[]});changed();renderClaims();}),claimList);
 function sourceEdit(s,key,value){s[key]=value;changed();}
 function renderSources(){sourceList.replaceChildren();for(const s of r.sources){const card=h('section',undefined,'panel'),grid=h('div',undefined,'form-grid');
  for(const [key,label,max]of [['title','자료명',300],['author','저자 · 연도',200],['locator','확인 위치 (쪽·줄·항목)',500],['filename','출처 파일명',300],['url','원문 주소 (선택)',1000],['via','재인용 경유 자료',500]]){const f=field(label,s[key]||'');f.el.maxLength=max;f.el.oninput=()=>sourceEdit(s,key,f.el.value);grid.append(f.box);}
  for(const [key,label,opts]of [['kind','자료 종류',Object.entries(SOURCE_KINDS)],['status','확인 상태',Object.entries(SOURCE_STATUS)],['access','접근 방식',[['direct','직접 자료'],['indirect','보고서·주석을 통한 재인용']]]]){const f=field(label,s[key],'select',opts);f.el.onchange=()=>sourceEdit(s,key,f.el.value);grid.append(f.box);}
  const note=field('확인 기록 · 자료 한계',s.note||'','textarea');note.el.maxLength=4000;note.el.rows=3;note.el.oninput=()=>sourceEdit(s,'note',note.el.value);
  card.append(h('h3','출처 '+(r.sources.indexOf(s)+1)),grid,note.box,button('출처 삭제',()=>{if(!confirm('출처를 삭제하고 연결된 주장에서 이 출처 연결도 지울까요?'))return;r.sources=r.sources.filter(x=>x.id!==s.id);for(const c of r.claims)c.sourceIds=c.sourceIds.filter(id=>id!==s.id);changed();renderSources();renderClaims();},'danger'));sourceList.append(card);
 }renderClaims();}
 function renderClaims(){claimList.replaceChildren();for(const c of r.claims){const card=h('section',undefined,'panel'),statement=field('주장 내용',c.text,'textarea');statement.el.maxLength=10000;statement.el.rows=3;statement.el.oninput=()=>{c.text=statement.el.value;changed();};card.append(statement.box);
  for(const [key,label,opts]of [['type','주장 구분',[['observation','본문 관찰'],['interpretation','해석 · 신학적 추론'],['hypothesis','역사·학술 가설'],['application','목회 적용']]],['confidence','확실성',[['high','높음'],['medium','중간'],['low','낮음 · 추가 확인']]]]){const f=field(label,c[key],'select',opts);f.el.onchange=()=>{c[key]=f.el.value;changed();};card.append(f.box);}
  const links=h('fieldset');links.append(h('legend','연결할 출처'));if(!r.sources.length)links.append(h('p','출처를 먼저 추가하세요.','subtle'));
  for(const s of r.sources){const label=h('label',undefined,'check'),check=h('input');check.type='checkbox';check.checked=c.sourceIds.includes(s.id);check.onchange=()=>{c.sourceIds=c.sourceIds.filter(id=>id!==s.id);if(check.checked)c.sourceIds.push(s.id);changed();};label.append(check,document.createTextNode(s.title||'제목 없는 출처'));links.append(label);}card.append(links,button('주장 삭제',()=>{r.claims=r.claims.filter(x=>x.id!==c.id);changed();renderClaims();},'danger'));claimList.append(card);
 }}
 function stopSpeech(){speechSession++;if('speechSynthesis'in window)speechSynthesis.cancel();}
 function readText(content){if(!('speechSynthesis'in window))throw new Error('이 브라우저는 음성 읽기를 지원하지 않습니다.');stopSpeech();const session=speechSession;const chunks=content.match(/[\s\S]{1,250}/g)||[];let pos=0;const next=()=>{if(session!==speechSession||pos>=chunks.length)return;const utterance=new SpeechSynthesisUtterance(chunks[pos++]);utterance.lang='ko-KR';utterance.rate=1;utterance.onend=next;utterance.onerror=()=>onMessage('음성 읽기를 중단했습니다. 브라우저의 한국어 음성을 확인해 주세요.');speechSynthesis.speak(utterance);};next();}
 function renderDocs(){docList.replaceChildren();for(const d of documents){const card=h('details',undefined,'research-section');card.dataset.search=[d.title,d.text||d.body||d.content||''].join(' ').normalize('NFKC').toLocaleLowerCase('ko');card.append(h('summary',d.title));
  const body=d.text||d.body||d.content||'';if(typeof body==='string'&&body){card.append(h('pre',body,'preview'),button('자료 읽어주기',()=>readText(body)),button('읽기 정지',stopSpeech));}
  if(d.attachment){card.append(h('p','PDF 원본 보관 · 본문 자동 추출 없음','subtle'),button('PDF 다운로드',()=>{const a=h('a');a.href=d.attachment.data;a.download=d.attachment.filename;a.click();}));}
  card.append(button('이 자료를 출처에 등록',()=>{r.sources.push({id:crypto.randomUUID(),title:d.title,filename:d.filename||d.attachment?.filename||d.title,kind:'other',status:'registered',access:'direct',locator:'',note:'',author:'',via:''});changed();renderSources();onMessage('출처 목록에 등록했습니다. 실제 열람 위치와 확인 기록을 입력하세요.');}));
  if(d.imported?.fields&&Object.keys(d.imported.fields).length)card.append(button('LRC 항목을 빈 연구칸에 채우기',()=>{
    if(!confirm('가져온 보고서의 내용을 빈 연구칸에만 채울까요? 주석 원문이 검증되었다고 표시하지 않습니다.'))return;
    let count=0;for(const [key,value]of Object.entries(d.imported.fields))if(!r.fields[key]?.trim()){r.fields[key]=value;fieldInputs[key].value=value;count++;}
    for(const source of d.imported.sources||[]){if(!r.sources.some(s=>s.filename===source.filename&&s.title===source.title))r.sources.push({...source,id:crypto.randomUUID(),via:d.title});}
    changed();renderSources();onMessage(`${count}개 빈 연구 항목을 채웠습니다. 재인용 출처는 미확인 상태로 등록했습니다. 연구 저장을 눌러 보관하세요.`);
  }));card.append(button('자료 파일 삭제',async()=>{if(!confirm('이 자료 파일을 브라우저에서 영구 삭제할까요? 먼저 필요한 원본을 별도 보관하세요. 출처와 연구 기록은 삭제하지 않습니다.'))return;await deleteDocument(d.id,sermon.id);documents=documents.filter(x=>x.id!==d.id);renderDocs();onMessage('자료 파일을 삭제했습니다. 남아 있는 출처 기록과 실제 접근 가능 여부를 다시 확인해 주세요.');},'danger'));card.hidden=!card.dataset.search.includes(docSearch.el.value.normalize('NFKC').toLocaleLowerCase('ko'));docList.append(card);
 }}
 upload.el.addEventListener('change',async()=>{
  const files=[...upload.el.files];if(!files.length)return;if(busy)return;
  busy=true;onBusy(true);upload.el.disabled=true;let count=0;
  try{for(const file of files){
    if(file.size>5*1024*1024)throw new Error(file.name+': 5MB 이하 파일을 선택해 주세요.');
    const d={sermonId:sermon.id,title:file.name.normalize('NFC').slice(0,300),filename:file.name.normalize('NFC').slice(0,300),createdAt:new Date().toISOString()};
    if(/\.pdf$/i.test(file.name)){const bytes=new Uint8Array(await file.slice(0,5).arrayBuffer());if(new TextDecoder().decode(bytes)!=='%PDF-')throw new Error('PDF 파일 형식을 확인해 주세요.');d.attachment={filename:d.filename,mime:'application/pdf',data:(await readDataURL(file)).replace(/^data:[^;]+;/,'data:application/pdf;')};}
    else if(/\.(html?|txt|md)$/i.test(file.name)){const content=await file.text();if(/\.html?$/i.test(file.name)){const parsed=parseResearchHTML(content);d.text=parsed.text;d.imported={fields:parsed.fields,sources:parsed.sources};d.title=parsed.title||d.title;}else{if(content.length>250000)throw new Error('텍스트 자료는 25만 자 이하로 가져와 주세요.');d.text=content;}}
    else throw new Error('HTML·TXT·MD·PDF만 가져올 수 있습니다.');
    d.id=await saveDocument(d);documents.push(d);count++;
   }renderDocs();onMessage(`${count}개 자료를 이 브라우저에 저장했습니다. HTML의 LRC 항목은 별도 채우기 버튼으로 연구에 연결하세요.`);
  }catch(err){renderDocs();onError(new Error(`${count}개 저장됨. ${err.message}`));}
  finally{busy=false;onBusy(false);upload.el.disabled=false;upload.el.value='';}
 });
 const qaContainer=h('div');containers.qa.append(h('h2','6개 관점 검수'),h('p','수동 검수 기록입니다. 연구 내용·출처·주장이 바뀌면 기존 검수와 승인은 해제됩니다.','help'),qaContainer);
 const qaInputs={};
 for(const [key,label]of Object.entries(QA)){const card=h('section',undefined,'panel'),q=r.qa[key]||{status:'UNCHECKED',note:'',reviewer:''},state=field(label+' 판정',q.status,'select',Object.entries(CHECK_STATUS)),reviewer=field(label+' 검토자',q.reviewer||''),note=field(label+' 검토 메모',q.note||'','textarea');reviewer.el.maxLength=200;note.el.maxLength=4000;note.el.rows=3;
  for(const el of [state.el,reviewer.el,note.el])el.addEventListener('input',()=>{r.qa[key]={status:state.el.value,reviewer:reviewer.el.value,note:note.el.value};changed(false);});
  qaInputs[key]={state:state.el,reviewer:reviewer.el,note:note.el};card.append(h('h3',label),state.box,reviewer.box,note.box);qaContainer.append(card);
 }
 function renderQA(){if(typeof qaInputs==='undefined')return;for(const [key,input]of Object.entries(qaInputs)){const q=r.qa[key]||{status:'UNCHECKED',reviewer:'',note:''};if(document.activeElement!==input.state)input.state.value=q.status;if(document.activeElement!==input.reviewer)input.reviewer.value=q.reviewer||'';if(document.activeElement!==input.note)input.note.value=q.note||'';}}
 const approveBy=field('대표본 승인자'),approveButton=button('검토 후 대표본 승인',async()=>{
  validateResearch(r);const problems=approvalProblems(r);if(problems.length)throw new Error('승인 전 보완 필요:\n'+problems.join('\n'));if(!approveBy.el.value.trim())throw new Error('승인자를 입력해 주세요.');
  r.approval={state:'APPROVED',by:approveBy.el.value.trim(),at:new Date().toISOString()};onDirty(true);await save();
 });approveBy.el.maxLength=200;containers.qa.append(h('h2','대표본 승인'),h('p','모든 검수 통과와 출처 원문 확인, 미완료 작업 해소 후 수동 승인합니다. 승인 전에도 미검증 사항을 포함한 작업본으로 내보낼 수 있습니다.','subtle'),approveBy.box,approveButton);
 const gapList=h('div'),tasks=h('div');containers.handoff.append(h('h2','필요한 자료와 후속 작업'),gapList,h('h3','직접 추가한 작업'),tasks);
 function renderGaps(){if(typeof gapList==='undefined')return;gapList.replaceChildren();const list=gaps(r);if(!list.length)gapList.append(h('p','등록 자료와 검수 기준의 자동 보완 항목이 없습니다. 실제 연구 품질은 직접 확인하세요.','subtle'));for(const item of list){const p=h('div',undefined,'task-row');p.append(h('strong',item.label),h('p',item.reason,'subtle'));gapList.append(p);}}
 const taskInput=field('추가할 후속 작업');taskInput.el.maxLength=500;containers.handoff.append(taskInput.box,button('작업 추가',()=>{if(!taskInput.el.value.trim())throw new Error('작업 내용을 입력해 주세요.');r.tasks.push({id:crypto.randomUUID(),label:taskInput.el.value.trim(),done:false});taskInput.el.value='';changed(false);renderTasks();}));
 function renderTasks(){tasks.replaceChildren();for(const t of r.tasks){const row=h('div',undefined,'row'),label=h('label',undefined,'check'),check=h('input');check.type='checkbox';check.checked=t.done;check.onchange=()=>{t.done=check.checked;changed(false);};label.append(check,document.createTextNode(t.label));row.append(label,button('작업 삭제',()=>{r.tasks=r.tasks.filter(x=>x.id!==t.id);changed(false);renderTasks();},'danger'));tasks.append(row);}}
 const filterPanel=h('details',undefined,'research-section');filterPanel.append(h('summary','필요한 전문 확인 (A01–A05)'));filterPanel.append(h('p','전문 파일이나 API가 연결된 상태가 아닙니다. 필요한 분야만 선택하고 실제로 검토한 근거와 결과를 적으세요.','subtle'));
 for(const [id,label]of Object.entries(FILTERS)){const existing=r.filters[id]||{required:false,status:'unverified',note:''},checkLabel=h('label',undefined,'check'),check=h('input');check.type='checkbox';check.checked=existing.required;checkLabel.append(check,document.createTextNode(id+' '+label));const state=field(id+' 확인 상태',existing.status,'select',[['unverified','미확인'],['checked','근거를 검토하고 기록함']]),note=field(id+' 근거 · 결과',existing.note,'textarea');note.el.maxLength=2000;note.el.rows=2;for(const el of [check,state.el,note.el])el.addEventListener('input',()=>{r.filters[id]={required:check.checked,status:state.el.value,note:note.el.value};changed();});filterPanel.append(checkLabel,state.box,note.box);}
 containers.handoff.append(filterPanel,h('h2','연구 결과 인계'),h('p','출처·확실성·미검증 사항·검수·승인·작업 목록을 함께 전달합니다. 작업본 내보내기는 대표본 승인이 아닙니다.','subtle'));
 const exports=h('div',undefined,'row');exports.append(button('설교 작성 요청문 다운로드',()=>output('sermon-from-research.txt',buildSermonPrompt(sermon,r))),button('연구 보고서 MD 내보내기',()=>output('sermon-research.md',researchMarkdown(sermon,r))),button('연구 인계 JSON 내보내기',()=>output('sermon-research-handoff.json',JSON.stringify(handoff(sermon,r),null,2),'application/json')),button('WORBS 요청문 다운로드',()=>output('worbs-request.txt',buildPrompt(sermon,r,'WORBS'))),button('BICS 요청문 다운로드',()=>output('bics-request.txt',buildPrompt(sermon,r,'BICS'))));containers.handoff.append(exports,h('p','요청문을 다른 AI에 전달하면 포함된 연구 기록과 출처 메모도 전달됩니다. 자료 범위를 확인한 후 직접 사용하세요.','help'));
 root.replaceChildren(title,progress,approval,toolbar,tabs,...Object.values(containers));renderSources();renderDocs();renderTasks();updateProgress();showTab();
 return()=>stopSpeech();
}
