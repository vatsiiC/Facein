# FaceIn - consent-first face attendance (prototype, dummy data only)

Node 22 + Express + SQLite (built-in `node:sqlite`), vanilla JS front end. Face recognition runs in the browser with
face-api.js (models from jsDelivr CDN); only a 128-number descriptor is stored, never an image.

## Run locally (webcam works on localhost)
    npm install
    npm start            # http://localhost:3000  (kiosk: http://localhost:3000/kiosk)
    npm run reset        # wipe the database; it reseeds on next start

Demo logins (password `Demo@123`): supervisor@ / hr@ / owner@ / admin@facein.demo.
Kiosk PIN demo: worker codes 1001-1040, PIN 1234.

## Deploy on a public HTTPS link (Render, free)
1. Push this folder to a GitHub repo.
2. Render -> New -> Blueprint -> pick the repo (uses `render.yaml`). You get `https://facein-xxxx.onrender.com`.
   Or use the `Dockerfile` on any Docker host (Railway, Fly.io, Cloud Run).
Note: free hosting disks are temporary, so the demo data reseeds after a restart or redeploy. For persistence, attach
a disk and set `DB_PATH` to a file on it.

## Environment
`SESSION_SECRET` (cookie signing), `FACE_THRESHOLD` (default 0.45; lower = stricter), `TZ` (default Asia/Kolkata),
`PORT`, `DB_PATH`.

## Assumptions
- Sunday is the weekly off; finished working days with no check-in become Absent.
- Payable days = Present + Late (after overrides). "This week" = last 7 days, "this month" = last 30 days.
- Worker codes are digits so they can be typed on the kiosk keypad. Every worker has a PIN as fallback.
- Seeded workers have consent records and historical face check-ins but no templates (no real faces in dummy data);
  enrol faces live from Workers -> worker -> Enrol face.
- Kiosk face match: distance <= 0.45 in 3 consecutive frames; the server re-checks the threshold, active consent and
  template before marking. BR1-BR5 are also enforced by SQLite constraints/triggers.
- Prototype only: the public kiosk endpoint serves face descriptors to the kiosk browser. A production build should
  register kiosk devices with a secret key and add PIN attempt limits.
