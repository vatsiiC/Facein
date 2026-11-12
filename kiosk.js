// FaceIn kiosk: public page, no login. Face matching runs in this browser; only worker id + match distance are sent.
const P = document.getElementById('panel'), video = document.getElementById('video');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let KIOSK_ID = null, THRESHOLD = 0.45, TEMPLATES = [];
let camOk = false, faceOk = false, camMsg = 'Starting camera...';
let state = 'loading', streak = 0, lastId = null, unknownFrames = 0, timer = null;

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Server error');
  return j;
}
function setPanel(cls, html) { P.className = 'k-panel ' + (cls || ''); P.innerHTML = html; }
function after(ms, fn) { clearTimeout(timer); timer = setTimeout(fn, ms); }
function bind(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }

function showScan() {
  clearTimeout(timer); state = 'scan'; streak = 0; lastId = null; unknownFrames = 0;
  if (camOk && faceOk) {
    setPanel('', `<p class="k-big">Look at the camera</p><p class="k-sub">One person at a time, face inside the circle.</p>
      <button class="k-btn ghost" id="pinbtn">Use PIN</button>
      <p class="note">Face check runs only on this device. No photo is sent or saved.<br>Did not agree to face attendance? Use PIN.</p>`);
  } else {
    setPanel('', `<p class="k-big">Use PIN</p><p class="k-sub">${esc(camMsg)}</p><button class="k-btn" id="pinbtn">Use PIN</button>`);
  }
  bind('pinbtn', showPin);
}

function showResult(r) {
  state = 'result';
  if (r.result === 'success') {
    setPanel('ok', `<p class="k-big">${esc(r.name)}</p><p class="k-big">Present ${esc(r.time)}</p>${r.status === 'late' ? '<span class="tag">Marked Late</span>' : ''}`);
  } else {
    setPanel('warn', `<p class="k-big">Already marked today</p><p class="k-sub">${esc(r.name)}${r.time ? ' - checked in at ' + esc(r.time) : ''}</p><p class="note">Nothing new was saved.</p>`);
  }
  after(3000, showScan);
}

function showNotRecognised() {
  state = 'unknown';
  setPanel('bad', `<p class="k-big">Not recognised</p><p class="k-sub">Try again, or use your worker code and PIN.</p>
    <div><button class="k-btn" id="pinbtn">Use PIN</button><button class="k-btn ghost" id="again">Try again</button></div>`);
  bind('pinbtn', showPin); bind('again', showScan);
  after(10000, showScan);
}

function showError(text) {
  state = 'error';
  setPanel('bad', `<p class="k-big">Something went wrong</p><p class="k-sub">${esc(text)}</p><button class="k-btn" id="again">OK</button>`);
  bind('again', showScan); after(5000, showScan);
}

// ---------- PIN ----------
let pinCtx = null;
function showPin() {
  clearTimeout(timer); state = 'pin';
  pinCtx = { stage: 'code', code: '', pin: '' };
  drawPin();
}
function drawPin(err) {
  const c = pinCtx;
  const disp = c.stage === 'code' ? (esc(c.code) || '&nbsp;') : '&#9679;'.repeat(c.pin.length) + '&#9675;'.repeat(4 - c.pin.length);
  setPanel('', `<p class="k-sub" style="margin:0 0 6px">${c.stage === 'code' ? 'Enter your worker code' : 'Enter your 4-digit PIN'}</p>
    <div class="pad-display">${disp}</div>${err ? `<p style="color:var(--bad);font-weight:700;margin:4px 0">${esc(err)}</p>` : ''}
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
      <button data-k="del" aria-label="Delete">&#9003;</button><button data-k="0">0</button><button class="go" data-k="ok">${c.stage === 'code' ? 'Next' : 'OK'}</button></div>
    <button class="k-btn ghost" id="cancel" style="margin-top:12px">Cancel</button>`);
  P.querySelectorAll('.pad button').forEach(b => b.onclick = () => pinKey(b.dataset.k));
  bind('cancel', showScan);
  after(30000, showScan); // idle timeout
}
function pinKey(k) {
  const c = pinCtx; if (state !== 'pin' || !c) return;
  if (k === 'del') { if (c.stage === 'pin' && !c.pin) c.stage = 'code'; else if (c.stage === 'code') c.code = c.code.slice(0, -1); else c.pin = c.pin.slice(0, -1); return drawPin(); }
  if (k === 'ok') {
    if (c.stage === 'code') { if (c.code.length < 3) return drawPin('Worker code is at least 3 digits'); c.stage = 'pin'; return drawPin(); }
    if (c.pin.length === 4) return submitPin(); return drawPin('PIN has 4 digits');
  }
  if (c.stage === 'code') { if (c.code.length < 6) c.code += k; return drawPin(); }
  if (c.pin.length < 4) c.pin += k;
  if (c.pin.length === 4) return submitPin();
  drawPin();
}
async function submitPin() {
  state = 'busy'; setPanel('', '<p class="k-big">Checking...</p>');
  try {
    const r = await post('/api/kiosk/pin', { kiosk_id: KIOSK_ID, employee_code: pinCtx.code, pin: pinCtx.pin });
    if (r.result === 'rejected') {
      state = 'rejected';
      setPanel('bad', `<p class="k-big">Not accepted</p><p class="k-sub">${esc(r.message)}</p><div><button class="k-btn" id="retry">Try again</button><button class="k-btn ghost" id="cancel">Cancel</button></div>`);
      bind('retry', showPin); bind('cancel', showScan); after(6000, showScan);
    } else showResult(r);
  } catch (e) { showError(e.message); }
}
document.addEventListener('keydown', e => {
  if (state !== 'pin') return;
  if (/^\d$/.test(e.key)) pinKey(e.key);
  else if (e.key === 'Backspace') pinKey('del');
  else if (e.key === 'Enter') pinKey('ok');
  else if (e.key === 'Escape') showScan();
});

// ---------- face loop ----------
async function submitFace(workerId, distance) {
  state = 'busy'; setPanel('', '<p class="k-big">Checking...</p>');
  try {
    const r = await post('/api/kiosk/face', { kiosk_id: KIOSK_ID, worker_id: workerId, distance: workerId ? Number(distance.toFixed(4)) : undefined });
    if (r.result === 'not_recognised') showNotRecognised(); else showResult(r);
  } catch (e) { showError(e.message); }
}
function handleFace(r) {
  if (!r || r.score < 0.6) { streak = 0; lastId = null; if (!r) unknownFrames = Math.max(0, unknownFrames - 1); return; }
  let best = null, bd = Infinity;
  for (const t of TEMPLATES) { const d = euclid(r.descriptor, t.descriptor); if (d < bd) { bd = d; best = t; } }
  if (best && bd <= THRESHOLD) { // BR4: strict threshold, and the same person in 3 consecutive frames
    unknownFrames = 0;
    if (best.worker_id === lastId) streak++; else { lastId = best.worker_id; streak = 1; }
    if (streak >= 3) submitFace(best.worker_id, bd);
  } else {
    streak = 0; lastId = null; unknownFrames++;
    if (unknownFrames >= 8) submitFace(null);
  }
}
async function loop() {
  try {
    if (state === 'scan' && camOk && faceOk && video.readyState >= 2) {
      const r = await readFace(video, 320);
      if (state === 'scan') handleFace(r);
    }
  } catch (e) { console.warn(e); }
  setTimeout(loop, 120);
}
async function loadTemplates() {
  try {
    const t = await (await fetch('/api/kiosk/templates')).json();
    TEMPLATES = t.map(x => ({ worker_id: x.worker_id, descriptor: Float32Array.from(x.descriptor) }));
  } catch (e) { console.warn('templates', e); }
}

// ---------- start ----------
function tick() { const d = new Date(); document.getElementById('clock').textContent = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
(async function init() {
  tick(); setInterval(tick, 1000);
  setPanel('', `<p class="k-big">Starting...</p><p class="k-sub">Loading camera and face recognition</p><button class="k-btn ghost" id="pinbtn">Use PIN</button>`);
  bind('pinbtn', showPin);
  const setup = await (await fetch('/api/kiosk/setup')).json();
  THRESHOLD = setup.threshold;
  const sel = document.getElementById('kiosk');
  sel.innerHTML = setup.kiosks.map(k => `<option value="${k.id}">${esc(k.name)} - ${esc(k.location)}</option>`).join('');
  let saved = null; try { saved = localStorage.getItem('facein_kiosk'); } catch (e) {}
  if (saved && setup.kiosks.some(k => String(k.id) === saved)) sel.value = saved;
  KIOSK_ID = Number(sel.value);
  sel.onchange = () => { KIOSK_ID = Number(sel.value); try { localStorage.setItem('facein_kiosk', sel.value); } catch (e) {} };

  const off = document.getElementById('camoff');
  try { await startCamera(video); camOk = true; }
  catch (e) { camMsg = 'Camera is not available. Please use your worker code and PIN.'; off.hidden = false; off.textContent = 'Camera unavailable'; document.getElementById('guide').hidden = true; }
  if (camOk) {
    try { await Promise.all([loadFaceApi(), loadTemplates()]); faceOk = true; }
    catch (e) { camMsg = 'Face recognition could not load. Please use your worker code and PIN.'; }
  }
  setInterval(loadTemplates, 60000);
  if (state === 'loading') showScan();
  loop();
})();
