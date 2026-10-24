# Smart Study Planner - Goal Based Academic Exam Preparation Dashboard
AKTU B.Tech CSE (semesters 1-8, session 2025-26). Vanilla HTML/CSS/JS + Node.js/Express + SQLite.

## Folder structure
```
smart-study-planner/
├─ server.js              Express app, security headers, static files
├─ package.json  .env.example  .gitignore
├─ src/
│  ├─ db.js               SQLite schema (planner.db), keys, constraints, indexes
│  ├─ seed.js             DEMO data only (sem 5 and 6)
│  ├─ auth.js             bcrypt sessions (hashed token in DB, httpOnly cookie), rate limit, admin check
│  ├─ routes.js           All REST APIs
│  ├─ planner.js          Study plan generation algorithm
│  └─ importer.js         PDF import pipeline (robots.txt check, hash dedupe, parse, map)
├─ public/
│  ├─ index.html          Page 1: Login / Signup
│  ├─ app.html            Sidebar shell for pages 2-8
│  ├─ css/style.css
│  └─ js/ common.js  auth.js  app.js
├─ test/smoke.js          Automated API smoke test
└─ uploads/               Imported PDFs are stored here
```

## Setup (Windows + VS Code)
1. Install Node.js LTS (v18 or newer) from nodejs.org. Open the folder in VS Code (File > Open Folder).
2. Open the terminal (Ctrl + `) and run:
```
npm install
copy .env.example .env
npm start
```
3. Open http://localhost:3000, sign up, and follow the sidebar: Academic Details > Study Goal > Study Plan.

Other commands: `npm run dev` (auto restart), `npm test` (smoke test, uses a temporary database), `npm run seed` (re-add DEMO data).
If `npm install` fails on `better-sqlite3`, install Node LTS (it ships prebuilt binaries), or install "Desktop development with C++" from Visual Studio Build Tools.

## How the plan works
Inputs: days to exam, daily minutes, goal, topic difficulty, weak flags (star on the syllabus page), incomplete topics, historical PYQ frequency.
- Back Clear: only backlog subjects you select; essential (previously asked) topics first, covers ~70% of them.
- Safe Score: syllabus coverage target ~60% of topics (easy and frequent first) for a ~50% score aim.
- Good Marks: all topics, then a longer revision phase with repeated cycles and a PYQ practice session every revision day.
- Study time per topic: easy 45, medium 75, hard 105 minutes. Revision starts right after the last study day. Every task has a "Why this topic?" explanation. Marks are never guaranteed.

## API testing examples
Windows PowerShell:
```
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod -Method Post http://localhost:3000/api/auth/register -WebSession $s -ContentType application/json -Body '{"name":"Riya Sharma","roll_no":"2201330100","email":"riya@example.com","password":"Passw0rd9","confirm_password":"Passw0rd9"}'
Invoke-RestMethod -Method Put http://localhost:3000/api/profile -WebSession $s -ContentType application/json -Body '{"year_of_study":3,"semester":5,"exam_date":"2026-12-10","hours_per_day":4}'
Invoke-RestMethod -Method Put http://localhost:3000/api/goal -WebSession $s -ContentType application/json -Body '{"goal_type":"safe_score"}'
Invoke-RestMethod -Method Post http://localhost:3000/api/plan/generate -WebSession $s
Invoke-RestMethod http://localhost:3000/api/dashboard -WebSession $s
```
curl (Git Bash / macOS / Linux): add `-c jar -b jar` to keep the session cookie:
```
curl -c jar -H "Content-Type: application/json" -d '{"email":"riya@example.com","password":"Passw0rd9"}' localhost:3000/api/auth/login
curl -b jar -X POST localhost:3000/api/plan/generate
curl -b jar -F kind=pyq -F exam_year=2024 -F subject_id=1 -F file=@paper.pdf localhost:3000/api/import/upload
```
Endpoints: `POST /api/auth/register|login|logout`, `GET /api/auth/me`, `GET|PUT /api/profile`, `GET /api/subjects`, `PUT /api/goal`, `GET /api/syllabus`, `POST /api/topics/:id/progress`, `GET /api/papers`, `GET /api/papers/:id/questions`, `GET /api/import/review`, `PATCH /api/mappings/:id`, `POST /api/import/upload|url`, `POST /api/plan/generate`, `GET /api/plan`, `PATCH /api/tasks/:id`, `GET /api/dashboard`, `GET /api/progress`.

## Feature status
**Completed and tested**
- Signup/login/logout, hashed passwords, session cookies, validation, per-user data isolation
- Academic details, goals (including backlog selection), dashboard, syllabus with completion and weak flags, plan generation for all 3 goals, task and topic progress sync, progress tracker
- PDF import: text extraction, syllabus parsing, question extraction, keyword topic mapping, review queue, duplicate rejection, provenance and verification status

**DEMO (sample data, not official)**
- Semester 5 and 6 subjects (codes `DEMO-5xx/6xx`), their units/topics, and 3 generated papers per subject (2022-2024). All are labelled DEMO in the UI.

**Pending / not included**
- Official AKTU syllabus and PYQ data (you must import real PDFs; imported data starts as "unverified")
- OCR for scanned PDFs, a UI to edit or add topics by hand, difficulty editing
- Password reset, email verification, CSRF tokens (SameSite=Lax cookies are used), persistent rate limiting
- Semesters 1-4 and 7-8 have no data until imported

## Notes on AKTU imports
Automatic download only accepts https links on aktu.ac.in and stops if robots.txt disallows the path or the site cannot be checked. The AKTU site layout was not tested from this environment, so if a download fails, download the PDF in your browser and use "Upload PDF". Check usage terms on the AKTU site before importing. Set `ADMIN_EMAILS` in `.env` to restrict imports and mapping review to specific accounts.
