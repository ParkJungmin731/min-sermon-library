import { allSermons, getSermon, saveSermon, makeBackup, restoreBackup, validateBackup, matches, newest, STATUS } from './data.js';
const main = document.querySelector('main'), notice = document.querySelector('#notice');
let page = '', routeVersion = 0, dirty = false, saving = false, generating = false;
let aiInput = { scripture: '', intent: '', audience: '장년', consent: false }, aiResult = null, pendingBackup = null;
const h = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
function button(text, fn, cls = '') { const b = h('button', text, cls); b.type = 'button'; b.addEventListener('click', () => Promise.resolve().then(fn).catch(error)); return b; }
function message(text, bad = false) { notice.textContent = text; notice.hidden = false; notice.classList.toggle('error', bad); notice.setAttribute('role', bad ? 'alert' : 'status'); }
function error(err) { console.error(err.name || 'Error'); message(err.message || '작업을 완료하지 못했습니다. 입력 내용을 유지했으니 다시 시도해 주세요.', true); }
function heading(title, subtitle) { const e = h('div', undefined, 'heading'), left = h('div'); left.append(h('p', 'MY SERMON LIBRARY', 'eyebrow'), h('h1', title), h('p', subtitle, 'subtle')); e.append(left); return e; }
function field(label, id, value = '', kind = 'input', options) {
  const wrap = h('div', undefined, 'field'), l = h('label', label); l.htmlFor = id;
  const el = h(kind); el.id = id; el.name = id;
  if (kind === 'select') for (const [v, text] of options) { const o = h('option', text); o.value = v; el.append(o); }
  el.value = value; wrap.append(l, el); return { wrap, el };
}
function download(name, content, type = 'application/json') { const url = URL.createObjectURL(new Blob([content], { type })), a = h('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function exportBackup() { const data = await makeBackup(); download('sermon-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 2)); message('백업 파일을 다운로드했습니다. 파일이 저장되었는지 확인해 주세요.'); }
function allowedToLeave() {
  if (saving || generating) { message('진행 중인 작업이 끝날 때까지 기다려 주세요.'); return false; }
  return !dirty || confirm('저장하지 않은 변경 사항이 있습니다. 이동하면 변경 사항이 사라집니다. 이동할까요?');
}
async function navigate(target, id) {
  if (!allowedToLeave()) return;
  dirty = false; page = target; const version = ++routeVersion;
  document.querySelectorAll('[data-page]').forEach(b => { if (b.dataset.page === target || target === 'editor' && b.dataset.page === 'library') b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  main.replaceChildren(h('p', '자료를 불러오는 중입니다…', 'subtle'));
  try {
    if (target === 'editor') await editor(id, version);
    else if (target === 'generator') await generator(version);
    else if (target === 'settings') settings();
    else {
      const sermons = await allSermons(); if (version !== routeVersion) return;
      if (target === 'library') library(sermons); else dashboard(sermons);
    }
    if (version === routeVersion) main.focus({ preventScroll: true });
  } catch (err) { if (version === routeVersion) { main.replaceChildren(h('h1', '서재를 열지 못했습니다'), h('p', '저장 공간 권한을 확인해 주세요. 기존 자료는 삭제하지 않았습니다.'), button('다시 시도', () => navigate(target, id))); error(err); } }
}
function cards(rows, parent, emptyText = '아직 저장된 설교가 없습니다. 새 설교를 작성해 보세요.') {
  if (!rows.length) { parent.append(h('p', emptyText, 'empty')); return; }
  const grid = h('div', undefined, 'cards');
  for (const s of rows) {
    const card = h('article', undefined, 'sermon-card');
    card.append(h('span', s.kind === 'ai-draft' ? 'AI 초안 · 검토 필요' : STATUS[s.status] || s.status || '아이디어', 'badge' + (s.kind === 'ai-draft' ? ' draft' : '')), h('h3', s.title), h('p', [s.scripture, s.audience].filter(Boolean).join(' · '), 'subtle'), h('p', (s.body || '본문을 작성해 주세요.').slice(0, 110), 'subtle'));
    const row = h('div', undefined, 'row between');
    row.append(h('span', s.date || '', 'subtle'), button(s.deletedAt ? '설교 복구' : '열기 · 편집', async () => {
      if (s.deletedAt) { const value = await getSermon(s.id); if (!value) throw new Error('자료를 찾지 못했습니다.'); delete value.deletedAt; value.updatedAt = new Date().toISOString(); await saveSermon(value); await navigate('library'); message('휴지통에서 복구했습니다.'); }
      else await navigate('editor', s.id);
    }));
    card.append(row); grid.append(card);
  }
  parent.append(grid);
}
function dashboard(rows) {
  rows = rows.filter(s => !s.deletedAt); const stats = h('div', undefined, 'stats');
  for (const [label, count] of [['전체 설교', rows.length], ['작성 중 · 아이디어', rows.filter(s => s.status !== 'Complete').length], ['완료', rows.filter(s => s.status === 'Complete').length]]) {
    const card = h('div', undefined, 'stat'); card.append(h('span', label, 'subtle'), h('strong', count + '편')); stats.append(card);
  }
  const recent = h('section', undefined, 'panel'); recent.append(h('h2', '최근 작업')); cards([...rows].sort(newest).slice(0, 6), recent);
  main.replaceChildren(heading('나의 사역 기록', '작은 기록이 쌓여, 다음 말씀을 준비하는 힘이 됩니다.'), stats, recent);
}
function library(rows) {
  const top = heading('내 설교', '제목과 본문, 성경 본문과 태그로 기록을 다시 찾아보세요.');
  const filters = h('div', undefined, 'filters');
  const search = field('통합 검색', 'search', ''); search.wrap.classList.add('search'); search.el.placeholder = '제목 · 내용 · 성경 · 태그';
  const state = field('상태', 'filter-status', '', 'select', [['', '모든 상태'], ...Object.entries(STATUS)]);
  const audiences = [...new Set(rows.map(s => s.audience).filter(Boolean))].sort();
  const audience = field('청중', 'filter-audience', '', 'select', [['', '모든 청중'], ...audiences.map(x => [x, x])]);
  const scripture = field('성경 본문', 'filter-scripture'); scripture.el.placeholder = '예: 로마서';
  const tag = field('태그', 'filter-tag'); tag.el.placeholder = '예: 감사';
  const order = field('정렬', 'sort', 'recent', 'select', [['recent', '최근 수정순'], ['title', '제목순']]);
  filters.append(...[search, state, audience, scripture, tag, order].map(x => x.wrap));
  const trash = h('label', undefined, 'check'), toggle = h('input'); toggle.type = 'checkbox'; trash.append(toggle, document.createTextNode('휴지통 보기'));
  const count = h('p', '', 'subtle'), list = h('section');
  const draw = () => { const found = rows.filter(s => Boolean(s.deletedAt) === toggle.checked && matches(s, search.el.value, state.el.value, audience.el.value, scripture.el.value, tag.el.value)).sort(order.el.value === 'recent' ? newest : (a, b) => a.title.localeCompare(b.title, 'ko')); count.textContent = found.length + '편'; list.replaceChildren(); cards(found, list, toggle.checked ? '휴지통이 비어 있습니다.' : '검색 결과가 없습니다. 조건을 바꾸거나 새 설교를 추가해 주세요.'); };
  filters.addEventListener('input', draw); toggle.addEventListener('change', draw);
  main.replaceChildren(top, filters, trash, count, list); draw();
}
async function editor(id, version) {
  let value = id ? await getSermon(id) : { title: '', body: '', date: new Date().toLocaleDateString('ko-KR'), status: 'Idea', tags: [] };
  if (version !== routeVersion) return;
  if (!value) throw new Error('설교를 찾지 못했습니다.');
  const form = h('form', undefined, 'panel'), grid = h('div', undefined, 'form-grid');
  const title = field('설교 제목', 'sermon-title', value.title); title.el.required = true; title.el.maxLength = 200; title.wrap.classList.add('full');
  const scripture = field('성경 본문', 'sermon-scripture', value.scripture || ''); scripture.el.maxLength = 300;
  const audience = field('청중', 'sermon-audience', value.audience || ''); audience.el.maxLength = 100;
  const tags = field('태그 (쉼표로 구분)', 'sermon-tags', (value.tags || []).join(', ')); tags.el.maxLength = 1000;
  const status = field('진행 상태', 'sermon-status', value.status || 'Idea', 'select', Object.entries(STATUS));
  if (!STATUS[value.status] && value.status) { const o = h('option', value.status); o.value = value.status; status.el.append(o); status.el.value = value.status; }
  grid.append(...[title, scripture, audience, tags, status].map(x => x.wrap));
  const body = field('설교 본문', 'sermon-body', value.body || '', 'textarea'); body.el.maxLength = 200000;
  const save = h('button', '저장하기', 'primary'); save.type = 'submit';
  const saveStatus = h('span', id ? '저장된 설교' : '새 설교 · 아직 저장되지 않았습니다', 'save-status'); saveStatus.setAttribute('role', 'status');
  const actions = h('div', undefined, 'row'); actions.append(save, button('목록으로', () => navigate('library')));
  if (id) actions.append(button('휴지통으로', async () => {
    if (!confirm('이 설교를 휴지통으로 옮길까요? 휴지통에서 복구할 수 있습니다. 저장하지 않은 변경은 반영되지 않습니다.')) return;
    const original = await getSermon(id); if (!original) throw new Error('설교를 찾지 못했습니다.');
    await saveSermon({ ...original, deletedAt: new Date().toISOString() }); dirty = false; await navigate('library'); message('휴지통으로 옮겼습니다.');
  }, 'danger'));
  const toolbar = h('div', undefined, 'toolbar'); toolbar.append(actions, saveStatus);
  form.append(grid, body.wrap, toolbar);
  form.addEventListener('input', () => { dirty = true; saveStatus.textContent = '저장하지 않은 변경 사항'; });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return; saving = true;
    const snapshot = [title.el.value, scripture.el.value, audience.el.value, tags.el.value, status.el.value, body.el.value];
    save.disabled = true; saveStatus.textContent = '저장 중…';
    try {
      const now = new Date().toISOString(), tagList = [...new Set(tags.el.value.split(',').map(x => x.trim()).filter(Boolean))];
      if (tagList.length > 30 || tagList.some(x => x.length > 100)) throw new Error('태그는 30개 이하, 각 100자 이하로 입력해 주세요.');
      const next = { ...value, title: title.el.value.trim(), scripture: scripture.el.value.trim(), audience: audience.el.value.trim(), tags: tagList, status: status.el.value, body: body.el.value, updatedAt: now, createdAt: value.createdAt || now };
      next.id = await saveSermon(next); value = next;
      const current = [title.el.value, scripture.el.value, audience.el.value, tags.el.value, status.el.value, body.el.value];
      dirty = snapshot.some((v, i) => v !== current[i]); saveStatus.textContent = dirty ? '저장 후 변경 사항이 있습니다' : '저장 완료 · ' + new Date().toLocaleTimeString('ko-KR'); message('설교를 저장했습니다.');
    } catch (err) { saveStatus.textContent = '저장 실패 · 입력 내용을 유지했습니다'; error(err); }
    finally { saving = false; save.disabled = false; }
  });
  const elements = [heading(id ? '설교 이어 쓰기' : '새 설교 작성', value.date || '말씀과 생각을 차분히 기록해 보세요.')];
  if (value.kind === 'ai-draft') elements.push(h('p', 'AI가 만든 초안입니다. 성경 해석·인용·적용을 직접 검토한 후 사용해 주세요.', 'help'));
  elements.push(form); main.replaceChildren(...elements);
}
function settings() {
  pendingBackup = null;
  const backup = h('section', undefined, 'panel'); backup.append(h('h2', '자료 백업과 복원'), h('p', '설교, AI 초안, 휴지통, 연결 자료를 JSON 파일로 보관합니다. 복원은 새 자료로 추가하며 기존 자료를 덮어쓰지 않습니다.', 'subtle'), button('전체 백업 다운로드', exportBackup, 'primary'));
  const file = field('복원할 백업 파일 (최대 20MB)', 'backup-file'); file.el.type = 'file'; file.el.accept = '.json,application/json'; const preview = h('div');
  file.el.addEventListener('change', async () => {
    pendingBackup = null; preview.replaceChildren(); const selected = file.el.files[0]; if (!selected) return;
    try {
      if (selected.size > 20 * 1024 * 1024) throw new Error('20MB 이하의 백업 파일을 선택해 주세요.');
      const data = validateBackup(JSON.parse(await selected.text())); pendingBackup = data;
      const box = h('div', undefined, 'backup-preview');
      box.append(h('h3', '복원 미리보기'), h('p', `설교 ${data.sermons.length}편 · 연결 자료 ${data.documents.length}개`), h('p', data.sermons.slice(0, 3).map(s => s.title).join(' / '), 'subtle'), h('p', '모든 자료를 새 항목으로 추가합니다. 같은 백업을 다시 복원하면 중복 자료가 생깁니다.', 'subtle'));
      const restore = button('확인 · 새 자료로 복원', async () => {
        if (!pendingBackup || !confirm('기존 자료를 유지하고 백업 자료를 추가할까요?')) return;
        restore.disabled = true;
        try { const count = await restoreBackup(pendingBackup); pendingBackup = null; preview.replaceChildren(h('p', count + '편을 복원했습니다. 내 설교에서 확인해 주세요.')); file.el.value = ''; message('기존 자료를 유지하고 복원을 완료했습니다.'); }
        finally { if (pendingBackup) restore.disabled = false; }
      }, 'primary'); box.append(restore); preview.append(box);
    } catch (err) { error(err); }
  });
  backup.append(h('hr', undefined, 'divider'), file.wrap, preview);
  const help = h('section', undefined, 'panel'); help.append(h('h2', '안전하게 사용하는 방법'), h('p', '같은 기기·브라우저·사이트 주소에서 자료가 이어집니다. 브라우저 데이터를 지우거나 기기를 바꾸기 전에 백업해 주세요. 백업 파일은 개인정보가 포함될 수 있으니 안전한 곳에 보관해 주세요.'), h('p', '저장 → 내 설교에서 검색 → 필요할 때 휴지통에서 복구하는 순서로 사용합니다. AI 초안은 검토 전용 자료로 별도 저장됩니다.'), h('p', '이전 버전에서 저장한 API 키는 이 버전이 시작할 때 제거됩니다. 새 API 키를 브라우저에 입력하거나 저장하지 않습니다.', 'subtle'));
  main.replaceChildren(heading('백업 · 설정', '사역의 기록을 안전하게 보관하세요.'), backup, help);
}
async function generator(version) {
  const form = h('form', undefined, 'panel'), scripture = field('성경 본문', 'ai-scripture', aiInput.scripture), intent = field('설교 의도', 'ai-intent', aiInput.intent, 'textarea'), audience = field('청중', 'ai-audience', aiInput.audience);
  scripture.el.maxLength = 300; scripture.el.required = true; intent.el.maxLength = 4000; intent.el.required = true; audience.el.maxLength = 100; intent.el.rows = 5;
  audience.el.required = true;
  const consent = h('label', undefined, 'check'), checkbox = h('input'); checkbox.type = 'checkbox'; checkbox.checked = aiInput.consent; consent.append(checkbox, document.createTextNode('생성 시 위 입력 내용이 AI 제공자에게 전송되는 데 동의합니다. 민감한 상담 내용이나 개인정보는 입력하지 않겠습니다.'));
  const connection = h('p', 'AI 서버 연결 상태를 확인하는 중입니다.', 'help'), generate = h('button', 'AI 초안 생성', 'primary'); generate.type = 'submit'; generate.disabled = true;
  const prompt = button('직접 사용할 요청문 다운로드', () => { remember(); if (!scripture.el.reportValidity() || !intent.el.reportValidity()) return; download('sermon-prompt.txt', `성경 본문: ${aiInput.scripture}\n설교 의도: ${aiInput.intent}\n청중: ${aiInput.audience}\n\n본문의 문맥을 존중하는 쉬운 구어체 설교 초안을 작성하세요. 핵심 메시지, 대지, 적용, 검토할 사항을 구분하세요. 제공되지 않은 인용·원어 설명은 만들지 말고 확인 필요로 표시하세요.`, 'text/plain;charset=utf-8'); });
  const actions = h('div', undefined, 'row'); actions.append(generate, prompt); const output = h('section');
  const remember = () => { aiInput = { scripture: scripture.el.value, intent: intent.el.value, audience: audience.el.value, consent: checkbox.checked }; };
  form.addEventListener('input', remember);
  form.append(scripture.wrap, intent.wrap, audience.wrap, consent, connection, actions);
  main.replaceChildren(heading('AI 설교 초안', '본문과 의도를 정리하고, 초안을 검토하며 말씀을 준비하세요.'), form, output);
  let available = false;
  try { const r = await fetch('./api/status', { headers: { Accept: 'application/json' } }); const data = r.ok ? await r.json() : {}; available = data.ready === true; }
  catch { /* Static hosting has no AI endpoint. */ }
  if (version !== routeVersion) return;
  generate.disabled = !available;
  connection.textContent = available ? '안전한 서버 연결이 준비되었습니다. 생성 결과는 직접 검토한 뒤 별도 저장하세요.' : 'AI 서버가 아직 연결되지 않았습니다. 현재는 요청문을 다운로드해 사용하실 수 있습니다. 설교 작성·저장·검색·백업은 계속 이용할 수 있습니다.';
  function renderResult() {
    output.replaceChildren(); if (!aiResult) return;
    output.append(h('h2', '검토할 초안'), h('div', aiResult.body, 'preview'));
    const save = button(aiResult.saved ? '별도 초안 저장 완료' : '검토용 초안으로 별도 저장', async () => {
      if (aiResult.saved) return; save.disabled = true;
      try {
        const now = new Date().toISOString();
        await saveSermon({ title: aiResult.title, scripture: aiResult.scripture, audience: aiResult.audience, body: aiResult.body, status: 'Idea', kind: 'ai-draft', tags: ['AI 초안', '검토 필요'], date: new Date().toLocaleDateString('ko-KR'), createdAt: now, updatedAt: now, ai: aiResult.meta });
        aiResult.saved = true; dirty = false; save.textContent = '별도 초안 저장 완료'; message('기존 설교를 유지하고 AI 초안을 별도로 저장했습니다.');
      } catch (err) { save.disabled = false; throw err; }
    }, 'primary'); save.disabled = Boolean(aiResult.saved); output.append(h('p', '출처가 제공되지 않은 해석·인용은 확인이 필요합니다. AI 응답은 자동으로 완성된 설교가 되지 않습니다.', 'help'), save);
  }
  renderResult();
  form.addEventListener('submit', async event => {
    event.preventDefault(); remember(); if (!available || generating) return;
    if (!checkbox.checked) { message('AI 전송 동의를 확인해 주세요.', true); return; }
    if (aiResult && !aiResult.saved && !confirm('저장하지 않은 AI 초안이 있습니다. 새로 생성할까요?')) return;
    generating = true; generate.disabled = true; generate.textContent = '초안 생성 중…';
    const input = { ...aiInput };
    try {
      const r = await fetch('./api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sermon-Request': '1' }, body: JSON.stringify(input), signal: AbortSignal.timeout(65000) });
      const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || 'AI 서버 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      if (typeof data.title !== 'string' || typeof data.body !== 'string' || !data.body.trim()) throw new Error('완성된 초안을 받지 못했습니다. 다시 시도해 주세요.');
      aiResult = { ...data, scripture: input.scripture, audience: input.audience, saved: false }; dirty = true; renderResult(); message('초안을 생성했습니다. 내용을 확인한 후 별도로 저장해 주세요.');
    } catch (err) { error(err.name === 'TimeoutError' ? new Error('응답 시간이 초과되었습니다. 입력과 이전 초안을 유지했습니다.') : err); }
    finally { generating = false; generate.disabled = false; generate.textContent = 'AI 초안 생성'; }
  });
}
window.addEventListener('beforeunload', e => { if (dirty || saving || generating) { e.preventDefault(); e.returnValue = ''; } });
document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.page)));
document.querySelector('.brand').addEventListener('click', e => { e.preventDefault(); navigate('dashboard'); });
document.querySelector('#new-sermon').addEventListener('click', () => navigate('editor'));
try { localStorage.removeItem('ai_api_key'); } catch { message('이전 API 키 설정을 지우지 못했습니다. 브라우저 저장 권한을 확인해 주세요.', true); }
navigate('dashboard');
