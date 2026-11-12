// FaceIn staff dashboard (Supervisor, HR, Owner, Admin). Vanilla JS, hash routing.
const V = document.getElementById('view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABEL = {
  present: 'Present', late: 'Late', absent: 'Absent', not_started: 'Shift not started', weekly_off: 'Weekly off',
  grant: 'Consent given', withdraw: 'Consent withdrawn', none: 'No consent (PIN only)',
  success: 'Success', already_marked: 'Already marked', rejected_unknown_face: 'Rejected - face not recognised',
  rejected_low_confidence: 'Rejected - low confidence', rejected_wrong_pin: 'Rejected - wrong PIN',
  rejected_unknown_code: 'Rejected - unknown worker code', rejected_inactive: 'Rejected - inactive worker', face: 'Face', pin: 'PIN',
  supervisor: 'Supervisor', hr: 'HR Clerk', owner: 'Owner', admin: 'Admin'
};
const pill = s => `<span class="pill ${String(s).startsWith('rejected') ? 'rejected' : esc(s)}">${esc(LABEL[s] || s)}</span>`;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const niceDate = s => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const msg = (text, kind = 'err') => `<div class="msg ${kind}">${esc(text)}</div>`;
let ME = null, SHIFTS = [], NOTICE = null, FLASH = '';

async function api(url, opts = {}) {
  const r = await fetch(url, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) { location.href = '/'; throw new Error('Please log in'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
const isSup = () => ME.role === 'supervisor';
const shiftOptions = (sel, all = true) => (all ? `<option value="">All shifts</option>` : '') +
  SHIFTS.map(s => `<option value="${s.id}" ${String(sel) === String(s.id) ? 'selected' : ''}>${esc(s.name)} (${s.start}-${s.end})</option>`).join('');
const recordLink = (r, date) => r.attendance_id ? `#/record/${r.attendance_id}` : `#/record/w/${r.worker_id}/${date}`;
function flash() { const f = FLASH; FLASH = ''; return f ? msg(f, 'ok') : ''; }

// ---------- routing ----------
const NAV = {
  supervisor: [['#/home', 'Home'], ['#/workers', 'Workers'], ['#/reports', 'Reports']],
  hr: [['#/home', 'Home'], ['#/workers', 'Workers'], ['#/reports', 'Reports']],
  owner: [['#/home', 'Home'], ['#/workers', 'Workers'], ['#/reports', 'Reports'], ['#/settings', 'Settings']],
  admin: [['#/admin', 'Admin']]
};
const ROUTES = [
  [/^#\/home$/, viewHome], [/^#\/workers$/, viewWorkers], [/^#\/workers\/new$/, viewNewWorker],
  [/^#\/workers\/(\d+)$/, viewWorker], [/^#\/workers\/(\d+)\/enrol$/, viewEnrol],
  [/^#\/record\/(\d+)$/, id => viewRecord({ id })], [/^#\/record\/w\/(\d+)\/(\d{4}-\d{2}-\d{2})$/, (w, d) => viewRecord({ worker_id: w, date: d })],
  [/^#\/reports$/, viewReports], [/^#\/settings$/, viewSettings], [/^#\/admin$/, viewAdmin]
];
let captureSession = 0;
async function route() {
  stopCamera(); captureSession++;
  const h = location.hash && location.hash !== '#/' ? location.hash : NAV[ME.role][0][0];
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', h.startsWith(a.getAttribute('href'))));
  for (const [re, fn] of ROUTES) {
    const m = h.match(re);
    if (m) { try { V.innerHTML = '<p class="muted">Loading...</p>'; await fn(...m.slice(1)); } catch (e) { V.innerHTML = msg(e.message); } window.scrollTo(0, 0); return; }
  }
  location.hash = NAV[ME.role][0][0];
}
(async function init() {
  ME = await api('/api/me');
  document.getElementById('who').textContent = `${ME.name} - ${LABEL[ME.role]}`;
  document.getElementById('nav').innerHTML = NAV[ME.role].map(([h, l]) => `<a href="${h}">${l}</a>`).join('');
  document.getElementById('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/'; };
  SHIFTS = await api('/api/shifts');
  if (ME.role !== 'admin') NOTICE = await api('/api/notice');
  window.addEventListener('hashchange', route);
  route();
})();

// ---------- Home ----------
const homeState = { date: today(), shift: '', tab: 'att' };
async function viewHome() {
  V.innerHTML = `<h1>Attendance</h1>
    <div class="card row">
      <div class="field"><label>Date</label><input type="date" id="h-date" value="${homeState.date}" max="${today()}"></div>
      <div class="field"><label>Shift</label><select id="h-shift">${shiftOptions(homeState.shift)}</select></div>
      <div class="field"><button class="ghost" id="h-refresh">Refresh</button></div>
    </div><div id="h-body"></div>`;
  const load = async () => {
    homeState.date = document.getElementById('h-date').value || today();
    homeState.shift = document.getElementById('h-shift').value;
    const d = await api(`/api/dashboard?date=${homeState.date}&shift_id=${homeState.shift}`);
    const c = d.counts;
    const body = document.getElementById('h-body');
    body.innerHTML = `<p class="muted" style="margin-top:0">${niceDate(d.date)}${c.not_started ? ` - ${c.not_started} not yet due (shift not started)` : ''}</p>
      <div class="grid" style="margin-bottom:16px">
        <div class="stat ok"><div class="n">${c.present}</div><div class="l">Present</div></div>
        <div class="stat warn"><div class="n">${c.late}</div><div class="l">Late</div></div>
        <div class="stat bad"><div class="n">${c.absent}</div><div class="l">Absent</div></div>
      </div>
      <div class="subtabs"><button data-t="att">Attendance</button><button data-t="exc">Exceptions (${d.exceptions.pin.length + d.exceptions.rejected.length + d.exceptions.absent.length})</button></div>
      <div id="h-tab"></div>`;
    const draw = () => {
      body.querySelectorAll('.subtabs button').forEach(b => b.classList.toggle('on', b.dataset.t === homeState.tab));
      const T = document.getElementById('h-tab');
      if (homeState.tab === 'att') T.innerHTML = `<div class="card">${attTable(d.rows, d.date)}</div>`;
      else T.innerHTML = `
        <div class="card"><h2>PIN check-ins (${d.exceptions.pin.length})</h2>${d.exceptions.pin.length ? attTable(d.exceptions.pin, d.date) : '<p class="muted">None</p>'}</div>
        <div class="card"><h2>Rejected attempts (${d.exceptions.rejected.length})</h2>${d.exceptions.rejected.length ? `<div class="table-wrap"><table>
          <tr><th>Time</th><th>Worker</th><th>Method</th><th>Result</th><th class="hide-sm">Kiosk</th></tr>
          ${d.exceptions.rejected.map(a => `<tr><td>${a.timestamp.slice(11, 16)}</td><td>${a.name ? esc(a.name) + ` <span class="muted">#${esc(a.employee_code)}</span>` : '<span class="muted">Unknown face</span>'}</td>
          <td>${pill(a.method)}</td><td>${pill(a.result)}</td><td class="hide-sm">${esc(a.kiosk)}</td></tr>`).join('')}</table></div>` : '<p class="muted">None</p>'}</div>
        <div class="card"><h2>Absent (${d.exceptions.absent.length})</h2>${d.exceptions.absent.length ? attTable(d.exceptions.absent, d.date) : '<p class="muted">None</p>'}</div>`;
      bindRowClicks(T);
    };
    body.querySelectorAll('.subtabs button').forEach(b => b.onclick = () => { homeState.tab = b.dataset.t; draw(); });
    draw();
  };
  ['h-date', 'h-shift'].forEach(id => document.getElementById(id).onchange = () => load().catch(e => document.getElementById('h-body').innerHTML = msg(e.message)));
  document.getElementById('h-refresh').onclick = () => load();
  await load();
}
function attTable(rows, date) {
  return `<div class="table-wrap"><table><tr><th>Worker</th><th class="hide-sm">Shift</th><th>Status</th><th>In</th><th>Method</th></tr>
    ${rows.map(r => `<tr class="${r.status === 'not_started' ? '' : 'click'}" data-href="${r.status === 'not_started' ? '' : recordLink(r, date)}">
      <td><strong>${esc(r.name)}</strong> <span class="muted">#${esc(r.employee_code)}</span></td>
      <td class="hide-sm">${esc(r.shift_name)}</td>
      <td>${pill(r.status)}${r.overrides ? ' <span class="muted" title="Overridden by supervisor">&#9998; overridden</span>' : ''}</td>
      <td>${esc(r.check_in_time || '-')}</td><td>${r.method ? pill(r.method) : '-'}</td></tr>`).join('')}</table></div>`;
}
function bindRowClicks(el) { el.querySelectorAll('tr[data-href]').forEach(tr => { if (tr.dataset.href) tr.onclick = () => location.hash = tr.dataset.href; }); }

// ---------- Workers ----------
const faceLabel = w => w.has_face ? '<span class="pill grant">Face enrolled</span>'
  : w.consent === 'grant' ? '<span class="pill late">Consent given - face not captured</span>'
  : w.consent === 'withdraw' ? '<span class="pill withdraw">Consent withdrawn - PIN only</span>' : '<span class="pill none">PIN only</span>';
async function viewWorkers() {
  const list = await api('/api/workers');
  V.innerHTML = `${flash()}<div class="row" style="margin-bottom:12px"><h1 style="margin:0">Workers (${list.length})</h1>
      ${isSup() ? '<a class="btn right" href="#/workers/new">+ Add worker</a>' : ''}</div>
    <div class="card row"><div class="field" style="flex:1"><label>Search</label><input id="w-q" placeholder="Name or worker code"></div>
      <div class="field"><label>Shift</label><select id="w-shift">${shiftOptions('')}</select></div></div>
    <div class="card"><div id="w-list"></div></div>`;
  const draw = () => {
    const q = document.getElementById('w-q').value.toLowerCase(), s = document.getElementById('w-shift').value;
    const rows = list.filter(w => (!s || String(w.shift_id) === s) && (!q || w.name.toLowerCase().includes(q) || w.employee_code.includes(q)));
    document.getElementById('w-list').innerHTML = `<div class="table-wrap"><table><tr><th>Code</th><th>Name</th><th class="hide-sm">Shift</th><th>Face / consent</th></tr>
      ${rows.map(w => `<tr class="click" data-href="#/workers/${w.id}"><td>${esc(w.employee_code)}</td><td><strong>${esc(w.name)}</strong>${w.active ? '' : ' <span class="muted">(inactive)</span>'}</td>
      <td class="hide-sm">${esc(w.shift_name)}</td><td>${faceLabel(w)}</td></tr>`).join('')}</table></div>`;
    bindRowClicks(document.getElementById('w-list'));
  };
  document.getElementById('w-q').oninput = draw; document.getElementById('w-shift').onchange = draw; draw();
}

async function viewWorker(id) {
  const d = await api(`/api/workers/${id}`), w = d.worker, c = d.consents[0];
  V.innerHTML = `${flash()}<p><a href="#/workers">&larr; All workers</a></p><h1>${esc(w.name)}</h1>
    <div class="card"><dl class="kv"><dt>Worker code</dt><dd>${esc(w.employee_code)}</dd><dt>Shift</dt><dd>${esc(w.shift_name)} (${w.start}-${w.end}, grace ${w.grace_minutes} min)</dd>
      <dt>Status</dt><dd>${w.active ? 'Active' : 'Inactive'}</dd><dt>PIN</dt><dd>Set (stored hashed)</dd></dl></div>
    <div class="card"><h2>Consent and face data</h2>
      <dl class="kv"><dt>Consent</dt><dd>${pill(d.consent)}${c ? ` <span class="muted">notice ${esc(c.notice_version)}, ${esc(c.timestamp)}</span>` : ''}</dd>
      <dt>Face template</dt><dd>${d.face ? `Stored since ${esc(d.face.created_at)} <span class="muted">(128 numbers only, no image)</span>` : 'None stored'}</dd></dl>
      <div id="w-msg"></div>
      ${isSup() ? `<div class="row" style="margin-top:12px">
        ${!d.face ? `<a class="btn" href="#/workers/${w.id}/enrol">Enrol face</a>` : ''}
        ${d.face || d.consent === 'grant' ? `<button class="danger" id="w-del">Delete face data</button>` : ''}</div>
        <p class="muted" style="font-size:.9rem">Deleting face data removes the template immediately and records a consent withdrawal. The worker can still use their PIN.</p>` : ''}
      <h3>Consent history</h3>${d.consents.length ? `<div class="table-wrap"><table><tr><th>When</th><th>Decision</th><th>Notice</th></tr>
        ${d.consents.map(x => `<tr><td>${esc(x.timestamp)}</td><td>${pill(x.decision)}</td><td>${esc(x.notice_version)}</td></tr>`).join('')}</table></div>` : '<p class="muted">No consent given. Worker uses PIN.</p>'}
    </div>
    <div class="card"><h2>Recent attendance</h2>${d.attendance.length ? `<div class="table-wrap"><table><tr><th>Date</th><th>Status</th><th>In</th></tr>
      ${d.attendance.map(a => `<tr class="click" data-href="#/record/${a.id}"><td>${niceDate(a.date)}</td><td>${pill(a.status)}${a.overrides ? ' <span class="muted">&#9998; overridden</span>' : ''}</td><td>${esc(a.check_in_time || '-')}</td></tr>`).join('')}
      </table></div>` : '<p class="muted">No records yet</p>'}</div>`;
  bindRowClicks(V);
  const del = document.getElementById('w-del');
  if (del) del.onclick = async () => {
    if (!confirm(`Delete face data for ${w.name}? This cannot be undone. The worker can still use their PIN.`)) return;
    try { await api(`/api/workers/${w.id}/delete-face`, { method: 'POST' }); FLASH = 'Face data deleted and consent withdrawal recorded.'; viewWorker(id); }
    catch (e) { document.getElementById('w-msg').innerHTML = msg(e.message); }
  };
}

// ---------- Enrolment ----------
const noticeHtml = () => `<div class="notice"><h2 style="margin-top:0">${esc(NOTICE.title)}</h2><p class="muted" style="margin-top:0">Notice version ${esc(NOTICE.version)}</p>
  <ul>${NOTICE.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
  <p class="muted">Read this notice to the worker in a language they understand. Do not pressure them.</p>
  <label class="check"><input type="checkbox" id="c-ok"> The worker has understood the notice and agrees to face attendance.</label>`;
const steps = (names, on) => `<div class="steps">${names.map((n, i) => `<span class="${i === on ? 'on' : ''}">${i + 1}. ${n}</span>`).join('')}</div>`;

function captureWidget(el, onDone) {
  const session = captureSession;
  el.innerHTML = `<div class="cam-box"><video playsinline muted></video></div>
    <p id="cap-msg" class="muted">Loading camera and face models...</p>
    <button type="button" id="cap-btn" disabled>Capture face</button>`;
  const video = el.querySelector('video'), m = el.querySelector('#cap-msg'), btn = el.querySelector('#cap-btn');
  Promise.all([loadFaceApi(), startCamera(video)]).then(() => {
    if (session !== captureSession) return stopCamera();
    m.textContent = 'Ask the worker to look straight at the camera, then press Capture.'; btn.disabled = false;
  }).catch(e => { m.innerHTML = msg('Camera or face models unavailable: ' + e.message + '. You can go back and choose PIN only.'); });
  btn.onclick = async () => {
    btn.disabled = true; m.textContent = 'Capturing... hold still';
    const samples = [];
    for (let i = 0; i < 20 && samples.length < 3; i++) {
      const r = await readFace(video, 416).catch(() => null);
      if (r && r.score >= 0.7) samples.push(r.descriptor);
      await new Promise(res => setTimeout(res, 200));
    }
    btn.disabled = false;
    if (samples.length < 3 || euclid(samples[0], samples[1]) > 0.35 || euclid(samples[1], samples[2]) > 0.35) {
      m.innerHTML = msg('Face not clear. Use good light, one person only, look straight at the camera and try again.'); onDone(null); return;
    }
    const avg = Array.from({ length: 128 }, (_, k) => (samples[0][k] + samples[1][k] + samples[2][k]) / 3);
    m.innerHTML = msg('Face captured: 128 numbers ready to save. No photo is saved.', 'ok'); btn.textContent = 'Retake';
    onDone(avg);
  };
}
const pinFields = () => `<div class="row"><div class="field"><label>4-digit PIN</label><input id="p1" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></div>
  <div class="field"><label>Confirm PIN</label><input id="p2" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></div></div>`;
const readPin = () => {
  const a = document.getElementById('p1').value, b = document.getElementById('p2').value;
  if (!/^\d{4}$/.test(a)) throw new Error('PIN must be exactly 4 digits'); if (a !== b) throw new Error('The two PINs do not match'); return a;
};

async function viewNewWorker() {
  if (!isSup()) throw new Error('Only a Supervisor can enrol workers');
  const wz = { step: 0, name: '', code: '', shift_id: SHIFTS[0] && SHIFTS[0].id, accepted: false, descriptor: null };
  const NAMES = ['Details', 'Consent', 'Face or PIN'];
  const render = () => {
    stopCamera(); captureSession++;
    if (wz.step === 0) {
      V.innerHTML = `<p><a href="#/workers">&larr; Cancel</a></p><h1>Add worker</h1>${steps(NAMES, 0)}<div class="card">
        <div class="field"><label>Full name</label><input id="n" value="${esc(wz.name)}"></div>
        <div class="row"><div class="field"><label>Worker code (digits, used on kiosk keypad)</label><input id="code" inputmode="numeric" value="${esc(wz.code)}"></div>
        <div class="field"><label>Shift</label><select id="sh">${shiftOptions(wz.shift_id, false)}</select></div></div>
        <div id="e"></div><button id="next">Next: consent</button></div>`;
      document.getElementById('next').onclick = () => {
        wz.name = document.getElementById('n').value.trim(); wz.code = document.getElementById('code').value.trim(); wz.shift_id = document.getElementById('sh').value;
        if (wz.name.length < 2) return document.getElementById('e').innerHTML = msg('Enter the worker name');
        if (!/^\d{3,6}$/.test(wz.code)) return document.getElementById('e').innerHTML = msg('Worker code must be 3 to 6 digits');
        wz.step = 1; render();
      };
    } else if (wz.step === 1) {
      V.innerHTML = `<h1>Add worker: ${esc(wz.name)}</h1>${steps(NAMES, 1)}<div class="card">${noticeHtml()}
        <div class="row"><button id="yes" disabled>Worker agrees - capture face</button><button class="ghost" id="no">Worker declines - PIN only</button><button class="ghost" id="back">Back</button></div></div>`;
      const ok = document.getElementById('c-ok'), yes = document.getElementById('yes');
      ok.onchange = () => yes.disabled = !ok.checked;
      yes.onclick = () => { wz.accepted = true; wz.step = 2; render(); };
      document.getElementById('no').onclick = () => { wz.accepted = false; wz.descriptor = null; wz.step = 2; render(); };
      document.getElementById('back').onclick = () => { wz.step = 0; render(); };
    } else {
      V.innerHTML = `<h1>Add worker: ${esc(wz.name)}</h1>${steps(NAMES, 2)}<div class="card">
        ${wz.accepted ? `<h2>Face capture</h2><p class="muted">Consent accepted (notice ${esc(NOTICE.version)}). Only numbers are stored, never an image.</p><div id="cap"></div><h2 style="margin-top:18px">Backup PIN</h2><p class="muted">Used if the camera is down or the face is not recognised.</p>`
          : `<h2>PIN only</h2><p class="muted">The worker declined face attendance. No face data will be collected. Set a PIN.</p>`}
        ${pinFields()}<div id="e"></div><div class="row"><button id="save" ${wz.accepted ? 'disabled' : ''}>Save worker</button><button class="ghost" id="back">Back</button></div></div>`;
      const save = document.getElementById('save');
      if (wz.accepted) captureWidget(document.getElementById('cap'), d => { wz.descriptor = d; save.disabled = !d; });
      document.getElementById('back').onclick = () => { wz.step = 1; wz.descriptor = null; render(); };
      save.onclick = async () => {
        try {
          const pin = readPin();
          const r = await api('/api/workers', { method: 'POST', body: { name: wz.name, employee_code: wz.code, shift_id: Number(wz.shift_id), pin,
            consent: { accepted: wz.accepted, notice_version: NOTICE.version }, descriptor: wz.accepted ? wz.descriptor : undefined } });
          stopCamera(); FLASH = `${wz.name} saved${wz.accepted ? ' with face template and consent' : ' with PIN only'}.`; location.hash = `#/workers/${r.id}`;
        } catch (e) { document.getElementById('e').innerHTML = msg(e.message); }
      };
    }
  };
  render();
}

async function viewEnrol(id) {
  if (!isSup()) throw new Error('Only a Supervisor can enrol faces');
  const d = await api(`/api/workers/${id}`), w = d.worker;
  let descriptor = null;
  V.innerHTML = `<p><a href="#/workers/${id}">&larr; Cancel</a></p><h1>Enrol face: ${esc(w.name)}</h1>${steps(['Consent', 'Face capture'], 0)}
    <div class="card">${noticeHtml()}<div class="row"><button id="yes" disabled>Worker agrees - capture face</button><button class="ghost" id="no">Worker declines</button></div></div>`;
  const ok = document.getElementById('c-ok'), yes = document.getElementById('yes');
  ok.onchange = () => yes.disabled = !ok.checked;
  document.getElementById('no').onclick = () => { FLASH = 'Worker declined. Nothing was recorded; they continue with PIN.'; location.hash = `#/workers/${id}`; };
  yes.onclick = () => {
    V.innerHTML = `<p><a href="#/workers/${id}">&larr; Cancel</a></p><h1>Enrol face: ${esc(w.name)}</h1>${steps(['Consent', 'Face capture'], 1)}
      <div class="card"><div id="cap"></div><div id="e"></div><button id="save" disabled style="margin-top:12px">Save consent and face template</button></div>`;
    const save = document.getElementById('save');
    captureWidget(document.getElementById('cap'), x => { descriptor = x; save.disabled = !x; });
    save.onclick = async () => {
      try { await api(`/api/workers/${id}/enrol-face`, { method: 'POST', body: { accepted: true, notice_version: NOTICE.version, descriptor } });
        stopCamera(); FLASH = 'Consent recorded and face template saved.'; location.hash = `#/workers/${id}`; }
      catch (e) { document.getElementById('e').innerHTML = msg(e.message); }
    };
  };
}

// ---------- Record detail + override ----------
async function viewRecord(q) {
  const d = await api(`/api/record?${new URLSearchParams(q)}`), r = d.record, w = d.worker;
  const success = d.attempts.find(a => a.result === 'success');
  V.innerHTML = `${flash()}<p><a href="javascript:history.back()">&larr; Back</a></p><h1>Attendance record</h1>
    <div class="card"><dl class="kv"><dt>Worker</dt><dd><a href="#/workers/${w.id}">${esc(w.name)}</a> #${esc(w.employee_code)}</dd>
      <dt>Date</dt><dd>${niceDate(r.date)}</dd><dt>Shift</dt><dd>${esc(w.shift_name)} (starts ${w.start}, grace ${w.grace_minutes} min)</dd>
      <dt>Status</dt><dd>${pill(r.status)}${r.id ? '' : ' <span class="muted">(no check-in)</span>'}</dd>
      <dt>Check-in</dt><dd>${esc(r.check_in_time || '-')}${success ? ` via ${pill(success.method)} at ${esc(success.kiosk)}` : ''}</dd></dl></div>
    ${isSup() ? `<div class="card"><h2>Override</h2>
      <div class="row"><div class="field"><label>New status</label><select id="o-st">${['present', 'late', 'absent'].filter(s => s !== r.status).map(s => `<option value="${s}">${LABEL[s]}</option>`).join('')}</select></div></div>
      <div class="field"><label>Reason (required)</label><textarea id="o-why" placeholder="e.g. Kiosk was down; verified from gate register"></textarea></div>
      <div id="o-e"></div><button id="o-save">Save override</button>
      <p class="muted" style="font-size:.9rem">Overrides are permanent. Old status, new status, your name and the time are recorded.</p></div>` : ''}
    <div class="card"><h2>Override history</h2>${d.overrides.length ? `<div class="table-wrap"><table><tr><th>When</th><th>Change</th><th>Reason</th><th>By</th></tr>
      ${d.overrides.map(o => `<tr><td>${esc(o.timestamp)}</td><td>${pill(o.old_status)} &rarr; ${pill(o.new_status)}</td><td>${esc(o.reason)}</td><td>${esc(o.supervisor)}</td></tr>`).join('')}</table></div>` : '<p class="muted">No overrides</p>'}</div>
    <div class="card"><h2>Kiosk attempts that day</h2>${d.attempts.length ? `<div class="table-wrap"><table><tr><th>Time</th><th>Method</th><th>Result</th><th class="hide-sm">Kiosk</th></tr>
      ${d.attempts.map(a => `<tr><td>${a.timestamp.slice(11, 19)}</td><td>${pill(a.method)}</td><td>${pill(a.result)}</td><td class="hide-sm">${esc(a.kiosk)}</td></tr>`).join('')}</table></div>` : '<p class="muted">No attempts</p>'}</div>`;
  const save = document.getElementById('o-save');
  if (save) save.onclick = async () => {
    const reason = document.getElementById('o-why').value.trim();
    if (reason.length < 5) return document.getElementById('o-e').innerHTML = msg('Write a reason (at least 5 characters)');
    try {
      const body = { new_status: document.getElementById('o-st').value, reason };
      if (r.id) body.attendance_id = r.id; else Object.assign(body, { worker_id: w.id, date: r.date });
      const res = await api('/api/override', { method: 'POST', body });
      FLASH = 'Override saved.';
      if (location.hash === `#/record/${res.attendance_id}`) viewRecord({ id: res.attendance_id }); else location.hash = `#/record/${res.attendance_id}`;
    } catch (e) { document.getElementById('o-e').innerHTML = msg(e.message); }
  };
}

// ---------- Reports ----------
const repState = { tab: 'daily', date: today(), shift: '', from: daysAgo(27), to: today() };
async function viewReports() {
  const tabs = [['daily', 'Daily by shift'], ['payable', 'Payable days']];
  if (ME.role === 'supervisor' || ME.role === 'owner') tabs.push(['summary', 'Summary']);
  if (!tabs.find(t => t[0] === repState.tab)) repState.tab = 'daily';
  V.innerHTML = `<h1>Reports</h1><div class="subtabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${repState.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="r-body"></div>`;
  V.querySelectorAll('.subtabs button').forEach(b => b.onclick = () => { repState.tab = b.dataset.t; viewReports(); });
  const B = document.getElementById('r-body');
  if (repState.tab === 'daily') {
    B.innerHTML = `<div class="card row"><div class="field"><label>Date</label><input type="date" id="r-date" value="${repState.date}" max="${today()}"></div>
      <div class="field"><label>Shift</label><select id="r-shift">${shiftOptions(repState.shift)}</select></div></div><div id="r-out"></div>`;
    const load = async () => {
      repState.date = document.getElementById('r-date').value || today(); repState.shift = document.getElementById('r-shift').value;
      const d = await api(`/api/reports/daily?date=${repState.date}&shift_id=${repState.shift}`);
      const groups = SHIFTS.filter(s => !repState.shift || String(s.id) === repState.shift);
      document.getElementById('r-out').innerHTML = groups.map(s => {
        const rows = d.rows.filter(r => r.shift_id === s.id), n = k => rows.filter(r => r.status === k).length;
        return `<div class="card"><h2>${esc(s.name)} shift (${s.start}-${s.end}) - ${niceDate(d.date)}</h2>
          <p><strong>Present ${n('present')}</strong> &middot; <strong>Late ${n('late')}</strong> &middot; <strong>Absent ${n('absent')}</strong>${n('not_started') ? ` &middot; Not started ${n('not_started')}` : ''}${n('weekly_off') ? ` &middot; Weekly off ${n('weekly_off')}` : ''}</p>
          ${attTable(rows, d.date)}</div>`;
      }).join('');
      bindRowClicks(document.getElementById('r-out'));
    };
    document.getElementById('r-date').onchange = load; document.getElementById('r-shift').onchange = load; await load();
  } else if (repState.tab === 'payable') {
    B.innerHTML = `<div class="card row"><div class="field"><label>From</label><input type="date" id="r-from" value="${repState.from}"></div>
      <div class="field"><label>To</label><input type="date" id="r-to" value="${repState.to}"></div>
      <div class="field"><button id="r-go">Show</button></div><div class="field"><a class="btn ghost" id="r-csv">Download CSV</a></div></div>
      <p class="muted">Payable days = Present + Late (after any supervisor overrides). Sundays are weekly off.</p><div id="r-out"></div>`;
    const load = async () => {
      repState.from = document.getElementById('r-from').value; repState.to = document.getElementById('r-to').value;
      document.getElementById('r-csv').href = `/api/reports/payable.csv?from=${repState.from}&to=${repState.to}`;
      const rows = await api(`/api/reports/payable?from=${repState.from}&to=${repState.to}`).catch(e => { document.getElementById('r-out').innerHTML = msg(e.message); return null; });
      if (!rows) return;
      document.getElementById('r-out').innerHTML = `<div class="card"><div class="table-wrap"><table><tr><th>Code</th><th>Name</th><th class="hide-sm">Shift</th><th>Present</th><th>Late</th><th>Absent</th><th>Payable</th></tr>
        ${rows.map(r => `<tr class="click" data-href="#/workers/${r.id}"><td>${esc(r.employee_code)}</td><td>${esc(r.name)}</td><td class="hide-sm">${esc(r.shift_name)}</td>
        <td>${r.present}</td><td>${r.late}</td><td>${r.absent}</td><td><strong>${r.payable_days}</strong></td></tr>`).join('')}</table></div></div>`;
      bindRowClicks(document.getElementById('r-out'));
    };
    document.getElementById('r-go').onclick = load; await load();
  } else {
    const s = await api('/api/reports/summary');
    const ok = s.compliance.templatesWithoutConsent === 0;
    const top = (rows, label) => rows.length ? `<div class="table-wrap"><table><tr><th>Worker</th><th>${label}</th></tr>${rows.map(r => `<tr class="click" data-href="#/workers/${r.id}"><td>${esc(r.name)} <span class="muted">#${esc(r.employee_code)}</span></td><td><strong>${r.n}</strong></td></tr>`).join('')}</table></div>` : '<p class="muted">None</p>';
    B.innerHTML = `<div class="card" style="border-left:6px solid ${ok ? 'var(--ok)' : 'var(--bad)'}"><h2>Compliance check</h2>
        <p style="font-size:1.1rem">Any face template stored without active consent?</p>
        <div class="stat ${ok ? 'ok' : 'bad'}" style="display:inline-block;min-width:160px"><div class="n">${s.compliance.templatesWithoutConsent}</div><div class="l">${ok ? 'None - compliant' : 'Needs action'}</div></div>
        <p class="muted">${s.compliance.templates} face template(s) stored in total. No images are stored.</p></div>
      <div class="card"><h2>PIN check-ins this week (${s.pinCheckins.length})</h2><p class="muted">${niceDate(s.weekFrom)} to ${niceDate(s.today)}</p>
        ${s.pinCheckins.length ? `<div class="table-wrap"><table><tr><th>When</th><th>Worker</th><th class="hide-sm">Kiosk</th></tr>${s.pinCheckins.map(p => `<tr><td>${esc(p.timestamp.slice(0, 16))}</td><td>${esc(p.name)} <span class="muted">#${esc(p.employee_code)}</span></td><td class="hide-sm">${esc(p.kiosk)}</td></tr>`).join('')}</table></div>` : '<p class="muted">None</p>'}</div>
      <div class="card"><h2>Overrides this week (${s.overrides.length})</h2>
        ${s.overrides.length ? `<div class="table-wrap"><table><tr><th>Record</th><th>Change</th><th>Reason</th><th class="hide-sm">By</th></tr>${s.overrides.map(o => `<tr class="click" data-href="#/record/${o.attendance_id}"><td>${esc(o.name)}<br><span class="muted">${esc(o.date)}</span></td><td>${pill(o.old_status)} &rarr; ${pill(o.new_status)}</td><td>${esc(o.reason)}</td><td class="hide-sm">${esc(o.supervisor)}<br><span class="muted">${esc(o.timestamp.slice(0, 16))}</span></td></tr>`).join('')}</table></div>` : '<p class="muted">None</p>'}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
        <div class="card"><h2>Top late arrivals this month</h2><p class="muted">Since ${niceDate(s.monthFrom)}</p>${top(s.topLate, 'Late days')}</div>
        <div class="card"><h2>Top overrides this month</h2><p class="muted">Since ${niceDate(s.monthFrom)}</p>${top(s.topOverrides, 'Overrides')}</div></div>`;
    bindRowClicks(B);
  }
}

// ---------- Owner settings (grace period only) ----------
async function viewSettings() {
  SHIFTS = await api('/api/shifts');
  V.innerHTML = `${flash()}<h1>Settings</h1><div class="card"><h2>Late grace period</h2><p class="muted">A check-in after shift start + grace minutes is marked Late.</p>
    ${SHIFTS.map(s => `<div class="row" style="border-bottom:1px solid var(--line);padding:8px 0"><div class="field" style="min-width:200px"><label>${esc(s.name)}</label><strong>${s.start} - ${s.end}</strong></div>
      <div class="field"><label>Grace (minutes)</label><input type="number" min="0" max="120" value="${s.grace_minutes}" data-g="${s.id}" style="width:120px"></div>
      <div class="field"><button data-save="${s.id}">Save</button></div></div>`).join('')}<div id="s-e"></div></div>`;
  V.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    try { await api(`/api/shifts/${b.dataset.save}`, { method: 'PUT', body: { grace_minutes: Number(V.querySelector(`[data-g="${b.dataset.save}"]`).value) } }); FLASH = 'Grace period saved.'; viewSettings(); }
    catch (e) { document.getElementById('s-e').innerHTML = msg(e.message); }
  });
}

// ---------- Admin ----------
async function viewAdmin() {
  if (ME.role !== 'admin') throw new Error('Admin only');
  const [users, kiosks] = await Promise.all([api('/api/admin/users'), api('/api/admin/kiosks')]);
  SHIFTS = await api('/api/shifts');
  const roleSel = (v, attr) => `<select ${attr}>${['supervisor', 'hr', 'owner', 'admin'].map(r => `<option value="${r}" ${r === v ? 'selected' : ''}>${LABEL[r]}</option>`).join('')}</select>`;
  V.innerHTML = `${flash()}<div class="row" style="margin-bottom:12px"><h1 style="margin:0">Admin</h1><a class="btn ghost right" href="/kiosk" target="_blank">Open kiosk</a></div><div id="a-e"></div>
    <div class="card"><h2>Users</h2><div class="table-wrap"><table><tr><th>Name</th><th>Email</th><th>Role</th><th>New password</th><th></th></tr>
      ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${roleSel(u.role, `data-role="${u.id}"`)}</td>
        <td><div class="row" style="flex-wrap:nowrap"><input type="password" placeholder="min 8 chars" data-pw="${u.id}" style="min-width:130px"><button class="small ghost" data-setpw="${u.id}">Set</button></div></td>
        <td>${u.id === ME.id ? '<span class="muted">you</span>' : `<button class="small danger" data-del="${u.id}">Delete</button>`}</td></tr>`).join('')}</table></div>
      <h3>Add user</h3><div class="row"><div class="field"><label>Name</label><input id="nu-name"></div><div class="field"><label>Email</label><input id="nu-email" type="email"></div>
        <div class="field"><label>Role</label>${roleSel('hr', 'id="nu-role"')}</div><div class="field"><label>Password</label><input id="nu-pw" type="password"></div>
        <div class="field"><button id="nu-add">Add user</button></div></div></div>
    <div class="card"><h2>Shifts</h2>${SHIFTS.map(s => `<div class="row" data-shift="${s.id}">
        <div class="field"><label>Name</label><input name="name" value="${esc(s.name)}"></div><div class="field"><label>Start</label><input name="start" type="time" value="${s.start}"></div>
        <div class="field"><label>End</label><input name="end" type="time" value="${s.end}"></div><div class="field"><label>Grace (min)</label><input name="grace_minutes" type="number" min="0" max="120" value="${s.grace_minutes}" style="width:110px"></div>
        <div class="field"><button data-ssave="${s.id}">Save</button></div></div>`).join('')}
      <h3>Add shift</h3><div class="row" data-shift="new"><div class="field"><label>Name</label><input name="name"></div><div class="field"><label>Start</label><input name="start" type="time"></div>
        <div class="field"><label>End</label><input name="end" type="time"></div><div class="field"><label>Grace (min)</label><input name="grace_minutes" type="number" value="10" style="width:110px"></div>
        <div class="field"><button data-ssave="new">Add shift</button></div></div></div>
    <div class="card"><h2>Kiosks</h2>${kiosks.map(k => `<div class="row" data-kiosk="${k.id}"><div class="field"><label>Name</label><input name="name" value="${esc(k.name)}"></div>
        <div class="field" style="flex:1"><label>Location</label><input name="location" value="${esc(k.location)}"></div><div class="field"><button data-ksave="${k.id}">Save</button></div></div>`).join('')}
      <h3>Add kiosk</h3><div class="row" data-kiosk="new"><div class="field"><label>Name</label><input name="name"></div><div class="field" style="flex:1"><label>Location</label><input name="location"></div>
        <div class="field"><button data-ksave="new">Add kiosk</button></div></div></div>`;
  const run = async (fn, ok) => { try { await fn(); FLASH = ok; viewAdmin(); } catch (e) { document.getElementById('a-e').innerHTML = msg(e.message); window.scrollTo(0, 0); } };
  const vals = el => Object.fromEntries([...el.querySelectorAll('input[name]')].map(i => [i.name, i.value]));
  V.querySelectorAll('[data-role]').forEach(s => s.onchange = () => run(() => api(`/api/admin/users/${s.dataset.role}`, { method: 'PUT', body: { role: s.value } }), 'Role updated.'));
  V.querySelectorAll('[data-setpw]').forEach(b => b.onclick = () => run(() => api(`/api/admin/users/${b.dataset.setpw}`, { method: 'PUT', body: { password: V.querySelector(`[data-pw="${b.dataset.setpw}"]`).value } }), 'Password updated.'));
  V.querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirm('Delete this user?') && run(() => api(`/api/admin/users/${b.dataset.del}`, { method: 'DELETE' }), 'User deleted.'));
  document.getElementById('nu-add').onclick = () => run(() => api('/api/admin/users', { method: 'POST', body: { name: document.getElementById('nu-name').value, email: document.getElementById('nu-email').value, role: document.getElementById('nu-role').value, password: document.getElementById('nu-pw').value } }), 'User added.');
  V.querySelectorAll('[data-ssave]').forEach(b => b.onclick = () => {
    const id = b.dataset.ssave, body = vals(V.querySelector(`[data-shift="${id}"]`)); body.grace_minutes = Number(body.grace_minutes);
    run(() => api(id === 'new' ? '/api/shifts' : `/api/shifts/${id}`, { method: id === 'new' ? 'POST' : 'PUT', body }), 'Shift saved.');
  });
  V.querySelectorAll('[data-ksave]').forEach(b => b.onclick = () => {
    const id = b.dataset.ksave, body = vals(V.querySelector(`[data-kiosk="${id}"]`));
    run(() => api(id === 'new' ? '/api/admin/kiosks' : `/api/admin/kiosks/${id}`, { method: id === 'new' ? 'POST' : 'PUT', body }), 'Kiosk saved.');
  });
}
