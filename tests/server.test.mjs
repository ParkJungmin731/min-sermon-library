import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, parseDraft, validateInput } from '../server.mjs';
import { validateBackup, matches } from '../data.js';
const validDraft = { status: 'completed', id: 'response-test', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ title: '감사의 믿음', message: '은혜를 기억합니다.', points: [{ heading: '감사', body: '은혜를 기억하는 삶입니다.' }], application: '오늘 감사한 일을 적어 보세요.', review: ['성경 본문 문맥을 확인하세요.'] }) }] }], usage: { input_tokens: 10, output_tokens: 20 } };
const input = { scripture: '골로새서 3:15~17', intent: '감사를 회복하는 설교', audience: '장년', consent: true };
const envBase = { OPENAI_API_KEY: 'fake-test-key', OPENAI_MODEL: 'test-model', APP_PASSWORD: 'test-only-password-123', SESSION_SECRET: 'test-session-secret-32-characters-minimum', DAILY_REQUEST_LIMIT: '2' };
async function fixture(t, upstream = async () => ({ ok: true, json: async () => validDraft }), extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sermon-test-'));
  const app = createApp({ env: { ...envBase, DATA_DIR: dir, ...extra }, fetch: upstream });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + app.address().port;
  t.after(async () => { await new Promise(r => app.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const login = await fetch(base + '/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: envBase.APP_PASSWORD }), redirect: 'manual' });
  assert.equal(login.status, 303); const cookie = login.headers.get('set-cookie').split(';')[0];
  const generate = (value = input, headers = {}) => fetch(base + '/api/generate', { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-Sermon-Request': '1', ...headers }, body: JSON.stringify(value) });
  return { app, base, cookie, generate, dir };
}
test('AI requires authentication, origin, consent; private files are not served', async t => {
  let called = 0; const f = await fixture(t, async () => { called++; return { ok: true, json: async () => validDraft }; });
  assert.equal((await fetch(f.base + '/api/status')).status, 401);
  assert.equal((await f.generate(input, { Cookie: '' })).status, 401);
  assert.equal((await f.generate(input, { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await f.generate({ ...input, consent: false })).status, 400);
  assert.equal((await fetch(f.base + '/.data/usage.json', { headers: { Cookie: f.cookie } })).status, 404);
  assert.equal(called, 0);
});
test('structured draft returned; key and input are absent from usage ledger', async t => {
  const f = await fixture(t, async (url, options) => { assert.equal(url, 'https://api.openai.com/v1/responses'); const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true); assert.equal(body.max_output_tokens, 6000); return { ok: true, json: async () => validDraft }; });
  const r = await f.generate(); assert.equal(r.status, 200); const value = await r.json(); assert.equal(value.title, '감사의 믿음'); assert.match(value.body, /검토할 사항/);
  const { readFileSync } = await import('node:fs'); const log = readFileSync(join(f.dir, 'usage.json'), 'utf8'); assert(!log.includes(input.intent)); assert(!log.includes(envBase.OPENAI_API_KEY));
});
test('incomplete, refused, malformed AI responses never become drafts', () => {
  for (const v of [{ status: 'incomplete' }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }, { status: 'completed', output: [] }]) assert.throws(() => parseDraft(v));
  assert.throws(() => validateInput({ ...input, intent: 'x'.repeat(4001) }));
});
test('upstream failure keeps response controlled and counts toward daily cap', async t => {
  const f = await fixture(t, async () => ({ ok: false, status: 500 }));
  assert.equal((await f.generate()).status, 502); assert.equal((await f.generate()).status, 502); assert.equal((await f.generate()).status, 429);
});
test('only one generation is in flight', async t => {
  let release, started; const gate = new Promise(r => { release = r; }), ready = new Promise(r => { started = r; });
  const f = await fixture(t, async () => { started(); await gate; return { ok: true, json: async () => validDraft }; });
  const first = f.generate(); await ready; assert.equal((await f.generate()).status, 429); release(); assert.equal((await first).status, 200);
});
test('server refuses unsafe AI config', () => {
  assert.throws(() => createApp({ env: { OPENAI_API_KEY: 'x' } }));
  assert.throws(() => createApp({ env: { APP_PASSWORD: 'short' } }));
});
test('backup rejects broken relations and duplicate IDs before writes', () => {
  const backup = { app: 'min-sermon-library', schemaVersion: 1, sermons: [{ id: 1, title: '기존 설교' }], documents: [] };
  assert.equal(validateBackup(backup), backup);
  assert.throws(() => validateBackup({ ...backup, sermons: [...backup.sermons, ...backup.sermons] }));
  assert.throws(() => validateBackup({ ...backup, documents: [{ id: 1, sermonId: 999, title: '잘못된 연결' }] }));
  assert.throws(() => validateBackup({ ...backup, schemaVersion: 99 }));
});
test('search supports body, combined terms and separate filters', () => {
  const s = { title: '감사의 믿음', body: '평강으로 살아갑니다', scripture: '골로새서 3:15', audience: '장년', tags: ['감사'], status: 'Writing' };
  assert(matches(s, '감사 평강', 'Writing', '장년', '골로새서', '감사')); assert(!matches(s, '평강', 'Complete')); assert(!matches(s, '없는단어'));
});
test('daily admission limit survives server restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sermon-restart-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...envBase, DAILY_REQUEST_LIMIT: '1', DATA_DIR: dir };
  for (const expected of [200, 429]) {
    const app = createApp({ env, fetch: async () => ({ ok: true, json: async () => validDraft }) });
    await new Promise(r => app.listen(0, '127.0.0.1', r));
    try {
      const base = 'http://127.0.0.1:' + app.address().port;
      const login = await fetch(base + '/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: env.APP_PASSWORD }), redirect: 'manual' });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const response = await fetch(base + '/api/generate', { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-Sermon-Request': '1' }, body: JSON.stringify(input) });
      assert.equal(response.status, expected);
    } finally { await new Promise(r => app.close(r)); }
  }
});
