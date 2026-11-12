// FaceIn data layer: schema (9 tables), business-rule triggers, seed data.
process.env.TZ = process.env.TZ || 'Asia/Kolkata';
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'facein.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const NOTICE = {
  version: 'v1.0',
  title: 'Face attendance - your choice',
  points: [
    'We would like to use your face to mark your attendance at the factory kiosk.',
    'We do NOT keep any photo or video of you. We keep only a list of 128 numbers calculated from your face.',
    'These numbers are used only to mark you Present or Late for your shift and to count your payable days.',
    'Saying no is fine. You will use your worker code and a 4-digit PIN instead. Your job and pay are not affected.',
    'You can change your mind at any time. Ask your supervisor to "Delete face data". It is deleted immediately and you can keep using your PIN.',
    'We keep the numbers only while you work here and your consent is active.'
  ]
};

db.exec(`
CREATE TABLE IF NOT EXISTS shift (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  start TEXT NOT NULL,
  "end" TEXT NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 120)
);
CREATE TABLE IF NOT EXISTS worker (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  employee_code TEXT NOT NULL UNIQUE,
  shift_id INTEGER NOT NULL REFERENCES shift(id),
  active INTEGER NOT NULL DEFAULT 1,
  pin_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('supervisor','hr','owner','admin'))
);
CREATE TABLE IF NOT EXISTS consent (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES worker(id),
  decision TEXT NOT NULL CHECK (decision IN ('grant','withdraw')),
  notice_version TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS face_template (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL UNIQUE REFERENCES worker(id),
  descriptor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kiosk (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkin_attempt (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER REFERENCES worker(id),
  kiosk_id INTEGER NOT NULL REFERENCES kiosk(id),
  method TEXT NOT NULL CHECK (method IN ('face','pin')),
  result TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_attendance (
  id INTEGER PRIMARY KEY,
  worker_id INTEGER NOT NULL REFERENCES worker(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','late','absent')),
  check_in_time TEXT,
  UNIQUE (worker_id, date)
);
CREATE TABLE IF NOT EXISTS override (
  id INTEGER PRIMARY KEY,
  attendance_id INTEGER NOT NULL REFERENCES daily_attendance(id),
  old_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  supervisor_id INTEGER NOT NULL REFERENCES app_user(id),
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_attempt_worker_ts ON checkin_attempt(worker_id, timestamp);
CREATE INDEX IF NOT EXISTS ix_attempt_ts ON checkin_attempt(timestamp);
CREATE INDEX IF NOT EXISTS ix_att_date ON daily_attendance(date);
CREATE INDEX IF NOT EXISTS ix_consent_worker ON consent(worker_id, id);

-- BR3: no face template without active consent
CREATE TRIGGER IF NOT EXISTS br3_template_needs_consent BEFORE INSERT ON face_template
WHEN COALESCE((SELECT decision FROM consent WHERE worker_id = NEW.worker_id ORDER BY id DESC LIMIT 1), 'none') <> 'grant'
BEGIN SELECT RAISE(ABORT, 'BR3: face template requires active consent'); END;
-- BR3: withdrawing consent deletes the template
CREATE TRIGGER IF NOT EXISTS br3_withdraw_deletes_template AFTER INSERT ON consent
WHEN NEW.decision = 'withdraw'
BEGIN DELETE FROM face_template WHERE worker_id = NEW.worker_id; END;
-- BR5: overrides are permanent
CREATE TRIGGER IF NOT EXISTS br5_override_no_delete BEFORE DELETE ON override
BEGIN SELECT RAISE(ABORT, 'Overrides can never be deleted'); END;
CREATE TRIGGER IF NOT EXISTS br5_override_no_update BEFORE UPDATE ON override
BEGIN SELECT RAISE(ABORT, 'Overrides can never be changed'); END;
`);

// ---------- helpers ----------
const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTs = d => `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmtHM = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const isSunday = dateStr => new Date(dateStr + 'T00:00:00').getDay() === 0;
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

const ACTIVE_CONSENT_SQL = `COALESCE((SELECT c.decision FROM consent c WHERE c.worker_id = w.id ORDER BY c.id DESC LIMIT 1), 'none')`;

// Close finished days: any active worker with no record on a past working day (Mon-Sat) is Absent.
let closedThrough = null;
function closeDays() {
  const yesterday = addDays(fmtDate(new Date()), -1);
  if (closedThrough === yesterday) return;
  let d = closedThrough ? addDays(closedThrough, 1)
    : (db.prepare('SELECT MIN(substr(created_at,1,10)) d FROM worker').get().d || yesterday);
  const ins = db.prepare(`INSERT OR IGNORE INTO daily_attendance (worker_id, date, status, check_in_time)
    SELECT id, ?, 'absent', NULL FROM worker WHERE active = 1 AND substr(created_at,1,10) <= ?`);
  tx(() => { for (; d <= yesterday; d = addDays(d, 1)) if (!isSunday(d)) ins.run(d, d); });
  closedThrough = yesterday;
}

// ---------- seed ----------
const NAMES = ['Ramesh Kumar', 'Sunita Devi', 'Arjun Patil', 'Lakshmi Narayanan', 'Mohammed Irfan', 'Priya Sharma',
  'Vijay Singh', 'Kavitha Rajan', 'Ganesh Murugan', 'Suresh Yadav', 'Anjali Gupta', 'Ravi Teja', 'Meena Kumari',
  'Abdul Rahman', 'Deepak Chauhan', 'Pooja Verma', 'Senthil Kumar', 'Rekha Pillai', 'Manoj Tiwari', 'Fatima Begum',
  'Karthik Subramanian', 'Geeta Rani', 'Rajesh Nair', 'Anita Joseph', 'Sanjay Mishra', 'Divya Krishnan', 'Prakash Reddy',
  'Shabana Khan', 'Mahesh Gowda', 'Nirmala Das', 'Ashok Pandey', 'Bhavani Shankar', 'Imran Shaikh', 'Lalitha Iyer',
  'Venkatesh Rao', 'Harpreet Kaur', 'Dinesh Yadav', 'Saroja Murthy', 'Tarun Bose', 'Usha Rani'];

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM app_user').get().c > 0) return false;
  let s = 20261112;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const now = new Date();
  const today = fmtDate(now);
  const dayStr = n => addDays(today, -n);

  tx(() => {
    const shiftIns = db.prepare('INSERT INTO shift (name, start, "end", grace_minutes) VALUES (?,?,?,?)');
    const morning = Number(shiftIns.run('Morning', '06:00', '14:00', 10).lastInsertRowid);
    const evening = Number(shiftIns.run('Evening', '14:00', '22:00', 10).lastInsertRowid);
    const shifts = { [morning]: { start: '06:00', grace: 10 }, [evening]: { start: '14:00', grace: 10 } };

    const pw = bcrypt.hashSync('Demo@123', 10);
    const userIns = db.prepare('INSERT INTO app_user (name, email, password_hash, role) VALUES (?,?,?,?)');
    const supId = Number(userIns.run('Kiran Mehta (Supervisor)', 'supervisor@facein.demo', pw, 'supervisor').lastInsertRowid);
    userIns.run('Revathi S (HR Clerk)', 'hr@facein.demo', pw, 'hr');
    userIns.run('Anand Raghavan (Owner)', 'owner@facein.demo', pw, 'owner');
    userIns.run('System Admin', 'admin@facein.demo', pw, 'admin');

    const kIns = db.prepare('INSERT INTO kiosk (name, location) VALUES (?,?)');
    const k1 = Number(kIns.run('Gate Kiosk', 'Main gate, security cabin').lastInsertRowid);
    const k2 = Number(kIns.run('Shop Floor Kiosk', 'Assembly line B entrance').lastInsertRowid);

    const created = dayStr(35) + ' 10:00:00';
    const wIns = db.prepare('INSERT INTO worker (name, employee_code, shift_id, active, pin_hash, created_at) VALUES (?,?,?,?,?,?)');
    const cIns = db.prepare('INSERT INTO consent (worker_id, decision, notice_version, timestamp) VALUES (?,?,?,?)');
    const declined = new Set([5, 13, 27, 34]);
    const WITHDRAWN = 9, WITHDRAW_DAY = 10;
    const chronicLate = new Set([3, 17, 25, 31]);
    const workers = NAMES.map((name, i) => {
      const shift_id = i < 22 ? morning : evening;
      const id = Number(wIns.run(name, String(1001 + i), shift_id, 1, bcrypt.hashSync('1234', 8), created).lastInsertRowid);
      if (!declined.has(i)) cIns.run(id, 'grant', NOTICE.version, dayStr(35) + ' 10:' + pad(10 + i) + ':00');
      return { i, id, shift_id };
    });
    // one worker withdrew consent (no template existed in seed, so nothing to delete)
    cIns.run(workers[WITHDRAWN].id, 'withdraw', NOTICE.version, dayStr(WITHDRAW_DAY) + ' 11:05:00');

    const aIns = db.prepare('INSERT INTO daily_attendance (worker_id, date, status, check_in_time) VALUES (?,?,?,?)');
    const tIns = db.prepare('INSERT INTO checkin_attempt (worker_id, kiosk_id, method, result, timestamp) VALUES (?,?,?,?,?)');
    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (let n = 28; n >= 0; n--) {
      const date = dayStr(n);
      if (isSunday(date)) continue;
      for (const w of workers) {
        const sh = shifts[w.shift_id];
        const startMin = toMin(sh.start);
        if (n === 0 && nowMin < startMin - 30) continue;
        const absP = 0.06, lateP = chronicLate.has(w.i) ? 0.32 : 0.07;
        if (n === 0 ? [7, 20, 29].includes(w.i) : rnd() < absP) { if (n > 0) aIns.run(w.id, date, 'absent', null); continue; }
        const late = rnd() < lateP;
        const ciMin = startMin + (late ? ri(sh.grace + 1, sh.grace + 40) : ri(-25, sh.grace - 2));
        if (n === 0 && ciMin > nowMin) continue; // not arrived yet today
        const hm = `${pad(Math.floor(ciMin / 60))}:${pad(ciMin % 60)}`;
        const ts = sec => `${date} ${hm}:${pad(sec)}`;
        const faceOk = !declined.has(w.i) && !(w.i === WITHDRAWN && n <= WITHDRAW_DAY);
        let method = faceOk && rnd() < 0.9 ? 'face' : 'pin';
        const kiosk = rnd() < 0.7 ? k1 : k2;
        if (method === 'face' && rnd() < 0.06) { tIns.run(null, kiosk, 'face', 'rejected_unknown_face', ts(2)); method = 'pin'; }
        if (method === 'pin' && rnd() < 0.07) tIns.run(w.id, kiosk, 'pin', 'rejected_wrong_pin', ts(20));
        const status = ciMin > startMin + sh.grace ? 'late' : 'present';
        aIns.run(w.id, date, status, hm);
        tIns.run(w.id, kiosk, method, 'success', ts(40));
        if (rnd() < 0.03) tIns.run(w.id, kiosk, method, 'already_marked', ts(55));
      }
    }

    // Overrides with reasons (spread over the last 4 weeks, several in the last 7 days)
    const REASONS = {
      'absent>present': ['Gate kiosk was down in the morning; verified from security gate register.',
        'On outdoor duty at vendor site (Sriperumbudur), approved by production head.',
        'Attended fire-safety training at the admin block, did not pass the gate kiosk.'],
      'late>present': ['Company bus broke down on the OMR route; whole bus arrived late.',
        'Heavy rain and waterlogging on the main road; plant head approved relaxation.',
        'Power cut at the kiosk caused a queue; worker was at the gate on time.'],
      'present>absent': ['Checked in but left within the first hour due to illness; marked absent as per policy.'],
      'late>absent': ['Arrived more than 3 hours late without approval; treated as absent.']
    };
    const oIns = db.prepare('INSERT INTO override (attendance_id, old_status, new_status, reason, supervisor_id, timestamp) VALUES (?,?,?,?,?,?)');
    const upd = db.prepare('UPDATE daily_attendance SET status = ? WHERE id = ?');
    const plan = [[1, 'late>present'], [2, 'absent>present'], [3, 'late>present'], [5, 'present>absent'], [6, 'late>present'],
      [8, 'absent>present'], [10, 'late>present'], [12, 'late>absent'], [14, 'absent>present'], [16, 'late>present'],
      [19, 'late>present'], [22, 'absent>present'], [25, 'present>absent']];
    const favour = [workers[3].id, workers[17].id, workers[25].id];
    for (const [n, key] of plan) {
      let date = dayStr(n);
      if (isSunday(date)) date = dayStr(n + 1);
      const [from, to] = key.split('>');
      const rows = db.prepare('SELECT id, worker_id FROM daily_attendance WHERE date = ? AND status = ?').all(date, from);
      if (!rows.length) continue;
      const pref = rows.filter(r => favour.includes(r.worker_id));
      const pool = pref.length && rnd() < 0.7 ? pref : rows;
      const r = pool[Math.floor(rnd() * pool.length)];
      const list = REASONS[key];
      upd.run(to, r.id);
      oIns.run(r.id, from, to, list[Math.floor(rnd() * list.length)], supId, `${date} 17:${pad(ri(5, 55))}:00`);
    }
  });
  return true;
}

module.exports = { db, tx, seed, closeDays, NOTICE, ACTIVE_CONSENT_SQL, pad, fmtDate, fmtTs, fmtHM, toMin, isSunday, addDays };
