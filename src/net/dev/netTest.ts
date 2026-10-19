/**
 * Dev page for the network layer (no game): http://localhost:5173/net-test.html
 * ?net=local — BroadcastChannel between tabs of this browser; ?fakemic=1 — oscillator instead of the mic;
 * ?netdebug=1 — console logs. window.__net / window.__netTest for automation.
 */
import { net, type Member } from '../session';
import { profile } from '../profile';
import { getTransport } from '../signal';

const app = document.getElementById('app')!;
app.innerHTML = `
  <h1>Сеть — тест <span class="badge" id="tr"></span> <span class="badge" id="myid"></span></h1>
  <section>
    <h2>Комната</h2>
    <div class="row"><label>Имя <input type="text" id="name" maxlength="16" size="12"></label></div>
    <div class="row">
      <button id="createPub">Создать публичную</button>
      <button id="createPriv">Создать приватную</button>
      <button id="quick">Быстрая игра</button>
    </div>
    <div class="row">
      <input type="text" id="code" placeholder="КОД" maxlength="7" size="7">
      <button id="join">Войти</button>
      <button id="leave">Выйти</button>
    </div>
    <div class="row" id="status"></div>
    <div class="row">
      <button id="ready">Готов</button>
      <button id="rstate">Хост: идёт игра</button>
      <span id="clock" class="badge"></span>
    </div>
    <div class="err" id="err"></div>
  </section>
  <section>
    <h2>Публичные комнаты</h2>
    <table><thead><tr><th>Код</th><th>Игроки</th><th>Состояние</th><th>Хост</th><th></th></tr></thead><tbody id="rooms"></tbody></table>
  </section>
  <section class="wide">
    <h2>Игроки</h2>
    <table><thead><tr><th>Имя</th><th>id</th><th>Хост</th><th>Связь</th><th>Пинг</th><th>Голос</th><th>Готов</th><th>Громкость</th><th></th></tr></thead><tbody id="members"></tbody></table>
  </section>
  <section>
    <h2>Чат</h2>
    <div id="chatLog"></div>
    <div class="row"><input type="text" id="chatIn" placeholder="Сообщение…" style="flex:1" maxlength="200"><button id="chatSend">Отправить</button></div>
  </section>
  <section>
    <h2>Голос</h2>
    <div class="row">
      <button id="vOn">Включить микрофон</button>
      <button id="vOff">Выключить</button>
      <label><input type="checkbox" id="ptt"> Push-to-talk</label>
      <button id="talk">Говорить (зажми / V)</button>
      <span class="dot" id="meDot"></span>
    </div>
    <div class="err" id="vErr"></div>
    <h2 style="margin-top:10px">Нагрузка</h2>
    <div class="row">
      <button id="flood">200 ненадёжных</button>
      <button id="floodR">200 надёжных</button>
    </div>
    <div id="floodOut"></div>
  </section>
  <section class="wide"><h2>Отладка</h2><pre id="dbg"></pre></section>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

$('tr').textContent = net.transport === 'local' ? 'local (BroadcastChannel)' : 'Supabase';
$('myid').textContent = 'id ' + net.myId;
// a duplicated tab may take a new id at startup
void profile.ready.then(() => { $('myid').textContent = 'id ' + net.myId; });
const nameIn = $<HTMLInputElement>('name');
nameIn.value = profile.name;
nameIn.addEventListener('change', () => profile.setName(nameIn.value));

function showErr(e: unknown) { $('err').textContent = e instanceof Error ? e.message : String(e); }
async function act(f: () => Promise<unknown>) {
  $('err').textContent = '';
  try { await f(); } catch (e) { showErr(e); }
  render();
}

$('createPub').onclick = () => act(() => net.create({ public: true }));
$('createPriv').onclick = () => act(() => net.create({ public: false }));
$('quick').onclick = () => act(() => net.quickMatch());
$('join').onclick = () => act(() => net.join($<HTMLInputElement>('code').value));
$('leave').onclick = () => { net.leave(); render(); };
$('ready').onclick = () => { const me = net.me; net.setMeta({ ready: !me?.ready }); };
$('rstate').onclick = () => net.setRoomState(net.roomState === 'lobby' ? 'playing' : 'lobby');

// ---- chat
function renderChat() {
  $('chatLog').innerHTML = net.chatLog
    .map((m) => `<div class="${chatHistory.has(m.from + m.ts) ? 'old' : ''}"><b>${esc(m.name)}</b>: ${esc(m.text)}</div>`)
    .join('');
  $('chatLog').scrollTop = 1e9;
}
const chatHistory = new Set<string>();
net.onChat((from, _text, ts, _name, history) => { if (history) chatHistory.add(from + ts); renderChat(); });
const sendChat = () => {
  const i = $<HTMLInputElement>('chatIn');
  if (net.chat(i.value)) i.value = '';
};
$('chatSend').onclick = sendChat;
$('chatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

// ---- voice
const pttBox = $<HTMLInputElement>('ptt');
pttBox.checked = net.voice.ptt;
pttBox.onchange = () => net.voice.setPTT(pttBox.checked);
$('vOn').onclick = async () => { const ok = await net.voice.enable(); $('vErr').textContent = ok ? '' : net.voice.error; render(); };
$('vOff').onclick = () => { net.voice.disable(); render(); };
const talk = $('talk');
talk.onpointerdown = () => net.voice.setTalking(true);
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) talk.addEventListener(ev, () => net.voice.setTalking(false));
addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !(e.target instanceof HTMLInputElement)) net.voice.setTalking(true); });
addEventListener('keyup', (e) => { if (e.code === 'KeyV') net.voice.setTalking(false); });
net.voice.onChange(() => renderVoice());

function renderVoice() {
  $('meDot').className = 'dot' + (net.voice.speaking ? ' live' : '');
  $('vOn').classList.toggle('on', net.voice.enabled);
  talk.classList.toggle('on', net.voice.talking);
  for (const el of document.querySelectorAll<HTMLElement>('[data-speak]')) {
    const id = el.dataset.speak!;
    const sp = id === net.myId ? net.voice.speaking : net.voice.isSpeaking(id);
    el.className = 'dot' + (sp ? ' live' : '');
  }
}

// ---- flood test: N messages to everyone, receivers report how many arrived (and in order)
interface FloodRun { run: string; n: number; reliable: boolean; t0: number; results: Record<string, { got: number; ordered: boolean; ms: number }> }
const runs: FloodRun[] = [];
const incoming = new Map<string, { got: number; last: number; ordered: boolean; timer: number; from: string; t0: number }>();
function flood(n = 200, reliable = false): FloodRun {
  const run: FloodRun = { run: Math.random().toString(36).slice(2, 8), n, reliable, t0: performance.now(), results: {} };
  runs.unshift(run);
  for (let i = 0; i < n; i++) net.send('all', 'flood', [run.run, i, n, 'x'.repeat(40)], reliable);
  renderFlood();
  return run;
}
net.on('flood', (d: [string, number, number], from) => {
  const [run, i] = d;
  const key = from + ':' + run;
  let s = incoming.get(key);
  if (!s) { s = { got: 0, last: -1, ordered: true, timer: 0, from, t0: performance.now() }; incoming.set(key, s); }
  s.got++;
  if (i < s.last) s.ordered = false;
  s.last = i;
  clearTimeout(s.timer);
  const st = s;
  // report once the burst is over
  s.timer = window.setTimeout(() => {
    net.send(from, 'flood-ack', { run, got: st.got, ordered: st.ordered, ms: Math.round(performance.now() - st.t0) }, true);
    incoming.delete(key);
  }, 1200);
});
net.on('flood-ack', (d: { run: string; got: number; ordered: boolean; ms: number }, from) => {
  const r = runs.find((x) => x.run === d.run);
  if (r) { r.results[from] = { got: d.got, ordered: d.ordered, ms: d.ms }; renderFlood(); }
});
$('flood').onclick = () => flood(200, false);
$('floodR').onclick = () => flood(200, true);
function renderFlood() {
  $('floodOut').innerHTML = runs.slice(0, 4).map((r) => {
    const res = Object.entries(r.results).map(([id, x]) =>
      `${esc(net.members.get(id)?.name ?? id)}: <b>${x.got}/${r.n}</b>${x.ordered ? '' : ' (не по порядку)'}`).join(', ') || 'ждём ответов…';
    return `<div>${r.reliable ? 'надёжные' : 'ненадёжные'} ×${r.n}: ${res}</div>`;
  }).join('');
}

// ---- rooms list
net.watchRooms(() => renderRooms());
function renderRooms() {
  const rows = net.rooms().map((r) =>
    `<tr><td><b>${r.code}</b></td><td>${r.n}/${r.max}</td><td>${r.state === 'lobby' ? 'лобби' : 'играют'}</td><td>${esc(r.host)}</td>` +
    `<td><button data-join="${r.code}">Войти</button></td></tr>`);
  $('rooms').innerHTML = rows.join('') || '<tr><td colspan="5" style="color:var(--dim)">пусто</td></tr>';
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-join]')) b.onclick = () => act(() => net.join(b.dataset.join!));
}

// ---- members + status
function linkCell(m: Member) { return m.isMe ? '—' : `<span class="${m.link}">${m.link}</span>`; }
function renderMembers() {
  const rows: string[] = [];
  for (const m of net.members.values()) {
    rows.push(`<tr>
      <td><span style="color:${esc(m.look.tagColor)}">●</span> ${esc(m.name)}${m.isMe ? ' (я)' : ''}</td>
      <td>${m.id}</td><td>${m.isHost ? '👑' : ''}</td><td>${linkCell(m)}</td>
      <td>${m.isMe ? '' : m.ping < 0 ? '…' : m.ping + ' мс'}</td>
      <td><span class="dot" data-speak="${m.id}"></span></td><td>${m.ready ? '✔' : ''}</td>
      <td>${m.isMe ? '' : `<input type="range" min="0" max="1.5" step="0.1" value="${net.voice.getVolume(m.id)}" data-vol="${m.id}"> <button data-mute="${m.id}" class="${m.muted ? 'on' : ''}">${m.muted ? 'вкл звук' : 'заглушить'}</button>`}</td>
      <td>${net.isHost && !m.isMe ? `<button data-kick="${m.id}">выгнать</button>` : ''}</td></tr>`);
  }
  $('members').innerHTML = rows.join('') || '<tr><td colspan="9" style="color:var(--dim)">не в комнате</td></tr>';
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-vol]')) el.oninput = () => net.voice.setVolume(el.dataset.vol!, Number(el.value));
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-mute]')) el.onclick = () => { net.voice.mute(el.dataset.mute!, !net.voice.isMuted(el.dataset.mute!)); renderMembers(); };
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-kick]')) el.onclick = () => net.kick(el.dataset.kick!);
  renderVoice();
}
function render() {
  const s = net.active
    ? `в комнате <b>${net.code}</b> (${net.isPublic ? 'публичная' : 'приватная'}), игроков ${net.members.size}, ` +
      `${net.isHost ? '<b>я хост</b>' : 'хост ' + esc(net.members.get(net.hostId ?? '')?.name ?? '?')}, ${net.roomState}` +
      (net.online ? '' : ' — <span style="color:var(--bad)">сервер недоступен</span>')
    : net.status === 'joining' ? 'подключаемся…' : 'не в комнате';
  $('status').innerHTML = s;
  $('ready').classList.toggle('on', !!net.me?.ready);
  $('rstate').classList.toggle('on', net.roomState === 'playing');
  renderMembers();
  renderChat();
}
net.onMembers(render);
net.onLeave((reason) => { if (reason === 'kicked') showErr('Хост выгнал тебя из комнаты'); render(); });

// live numbers (ping, clock, links) without rebuilding the table on every frame
setInterval(() => {
  $('clock').textContent = 'net.time ' + net.time().toFixed(2);
  $('dbg').textContent = JSON.stringify(net.debug(), null, 1);
  for (const m of net.members.values()) {
    const row = document.querySelector(`[data-speak="${m.id}"]`)?.closest('tr');
    const cell = row?.children[4];
    if (cell && !m.isMe) cell.textContent = m.ping < 0 ? '…' : m.ping + ' мс';
  }
}, 500);
render();

/** automation hooks */
const w = window as unknown as Record<string, unknown>;
w.__net = net;
w.__netTest = {
  flood,
  runs,
  members: () => [...net.members.values()].map((m) => ({ id: m.id, name: m.name, host: m.isHost, link: m.link, ping: m.ping, speaking: m.speaking, ready: m.ready })),
  /** ?net=local only: cut / restore this tab's "server" link (presence dropped, nothing in or out) */
  outage: (on: boolean) => { (getTransport() as { simulateOutage?: (b: boolean) => void }).simulateOutage?.(on); },
  wire: () => ({ ...getTransport().stats }),
};
