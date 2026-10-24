// Controlled import pipeline for AKTU documents (PYQ papers and syllabus PDFs).
// Steps: access check -> download -> hash/dedupe -> text extraction -> parse -> map -> store provenance.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const db = require('./db');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_HOSTS = ['aktu.ac.in', 'www.aktu.ac.in'];
const MAX_BYTES = (+process.env.MAX_UPLOAD_MB || 15) * 1024 * 1024;
const STOP = new Set('with that this from have what which explain write short note give discuss describe define differentiate between among their there about using used into also example examples suitable following each any all and the for are not how why when where'.split(' '));

class ImportError extends Error { constructor(m) { super(m); this.name = 'ImportError'; } }

// 1. Check website access and usage restrictions (host allow-list + robots.txt).
async function checkAccess(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new ImportError('Invalid URL.'); }
  if (u.protocol !== 'https:') throw new ImportError('Only https:// URLs are allowed.');
  if (!ALLOWED_HOSTS.includes(u.hostname)) throw new ImportError('Automated download is limited to official AKTU hosts (aktu.ac.in). Use manual PDF upload for other sources.');
  try {
    const r = await fetch(`${u.origin}/robots.txt`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const txt = await r.text();
      let applies = false;
      for (const raw of txt.split(/\r?\n/)) {
        const line = raw.split('#')[0].trim();
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const k = m[1].toLowerCase(), v = m[2].trim();
        if (k === 'user-agent') applies = v === '*';
        else if (applies && k === 'disallow' && v && u.pathname.startsWith(v)) {
          throw new ImportError('robots.txt disallows automated access to this path. Download the PDF manually and upload it instead.');
        }
      }
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('Could not verify robots.txt / site access. Download the PDF manually and use the upload option.');
  }
  return u;
}

async function download(rawUrl) {
  const u = await checkAccess(rawUrl);
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'SmartStudyPlanner/1.0 (student project)' } }); }
  catch { throw new ImportError('Download failed or blocked. Use manual PDF upload.'); }
  if (!r.ok) throw new ImportError(`Server answered ${r.status}. Use manual PDF upload.`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new ImportError('File is too large.');
  return { buffer: buf, sourceUrl: u.href };
}

function tokens(s) {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
}

// 4/5. Identify questions in extracted text.
function extractQuestions(text) {
  const start = /^(?:Q\.?\s*\d+[.)]?|\d{1,2}[.)]|\(?[a-j][.)])\s+(.{8,})$/i;
  const skip = /^(page|roll|printed|section|time|max|note|attempt|sub\.? ?code|b\.?tech)/i;
  const out = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    const m = l.match(start);
    if (m) { if (cur) out.push(cur); cur = m[1]; }
    else if (cur && !skip.test(l) && cur.length < 400) cur += ' ' + l;
  }
  if (cur) out.push(cur);
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 15 && s.length <= 500);
}

// Heuristic syllabus parser: finds "UNIT-1 / Unit II" headings and splits following text into topics.
function parseSyllabus(text) {
  const rom = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
  const re = /^\s*unit[\s\-–:]*([1-6]|vi|iv|v|iii|ii|i)\b[\s\-–:.]*(.*)$/i;
  const units = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(re);
    if (m) {
      const no = /^\d$/.test(m[1]) ? +m[1] : rom[m[1].toLowerCase()];
      cur = { no, title: (m[2] || '').slice(0, 80).trim() || `Unit ${no}`, body: '' };
      units.push(cur);
    } else if (cur) cur.body += ' ' + raw;
  }
  return units.map((u) => ({
    no: u.no, title: u.title,
    topics: [...new Set(u.body.split(/[,;.\n]/).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 4 && s.length <= 90))].slice(0, 25),
  })).filter((u) => u.topics.length);
}

// 5. Map a question to syllabus topics by keyword overlap. High = auto, medium = needs manual review.
function mapQuestion(qText, topics) {
  const qt = tokens(qText);
  return topics.map((t) => {
    const tt = tokens(t.name);
    if (!tt.size) return null;
    let hit = 0; tt.forEach((w) => { if (qt.has(w)) hit++; });
    return { topic_id: t.id, confidence: +(hit / tt.size).toFixed(2) };
  }).filter((x) => x && x.confidence >= 0.3).sort((a, b) => b.confidence - a.confidence).slice(0, 2)
    .map((x) => ({ ...x, status: x.confidence >= 0.6 ? 'auto' : 'needs_review' }));
}

async function importPdf({ buffer, kind, subjectId, year, semester, newSubject, sourceUrl, storeFile = true }) {
  if (!buffer || buffer.slice(0, 5).toString() !== '%PDF-') throw new ImportError('The file is not a valid PDF.');
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  if (db.prepare('SELECT 1 FROM import_log WHERE file_hash=?').get(hash)) throw new ImportError('Duplicate: this exact file was already imported.');

  let text;
  try { text = (await pdfParse(buffer)).text || ''; } catch { throw new ImportError('Could not read this PDF (it may be scanned, damaged or use an unsupported structure). Try re-saving it with "Print to PDF" and upload again.'); }
  if (text.trim().length < 40) throw new ImportError('No extractable text found. Scanned PDFs need OCR, which is not included.');

  let pdfUrl = null;
  if (storeFile) { fs.writeFileSync(path.join(UPLOAD_DIR, `${hash}.pdf`), buffer); pdfUrl = `/uploads/${hash}.pdf`; }
  const verification = 'unverified';
  const log = (status, notes) => db.prepare('INSERT INTO import_log(file_hash,kind,source_url,status,notes) VALUES (?,?,?,?,?)')
    .run(hash, kind, sourceUrl || null, status, notes);

  if (kind === 'pyq') {
    const subject = db.prepare('SELECT * FROM subjects WHERE id=?').get(subjectId);
    if (!subject) throw new ImportError('Choose a valid subject.');
    const topics = db.prepare('SELECT id,name FROM topics WHERE subject_id=?').all(subject.id);
    if (!topics.length) throw new ImportError('This subject has no syllabus topics yet. Import its syllabus first.');
    const qs = extractQuestions(text);
    if (!qs.length) throw new ImportError('No questions could be identified. Check the PDF format.');
    return db.transaction(() => {
      const pid = db.prepare(`INSERT INTO question_papers(subject_id,exam_year,semester,pdf_url,source_url,file_hash,is_demo,verification_status)
        VALUES (?,?,?,?,?,?,0,?)`).run(subject.id, year, subject.semester, pdfUrl, sourceUrl || null, hash, verification).lastInsertRowid;
      let auto = 0, review = 0, unmapped = 0;
      qs.forEach((q, i) => {
        const qid = db.prepare('INSERT INTO extracted_questions(paper_id,q_no,text) VALUES (?,?,?)').run(pid, i + 1, q).lastInsertRowid;
        const maps = mapQuestion(q, topics);
        if (!maps.length) unmapped++;
        maps.forEach((m, k) => { db.prepare('INSERT OR IGNORE INTO topic_question_mapping(question_id,topic_id,confidence,status) VALUES (?,?,?,?)').run(qid, m.topic_id, m.confidence, m.status); if (k === 0) m.status === 'auto' ? auto++ : review++; });
      });
      log('imported', `${qs.length} questions`);
      return { paper_id: pid, questions: qs.length, auto_mapped: auto, needs_review: review, unmapped, verification_status: verification };
    })();
  }

  if (kind === 'syllabus') {
    let sid = subjectId;
    if (!sid) {
      if (!newSubject || !newSubject.code || !newSubject.name || !(newSubject.semester >= 1 && newSubject.semester <= 8)) throw new ImportError('Provide subject code, name and semester (1-8).');
      db.prepare(`INSERT OR IGNORE INTO subjects(code,name,semester,is_demo,source_url,verification_status) VALUES (?,?,?,0,?,?)`)
        .run(newSubject.code.trim(), newSubject.name.trim(), newSubject.semester, sourceUrl || null, verification);
      sid = db.prepare('SELECT id FROM subjects WHERE code=? AND semester=?').get(newSubject.code.trim(), newSubject.semester).id;
    }
    const units = parseSyllabus(text);
    if (!units.length) throw new ImportError('No "Unit" headings found. Check the PDF format or add topics manually.');
    return db.transaction(() => {
      let n = 0;
      for (const u of units) {
        db.prepare('INSERT OR IGNORE INTO syllabus_units(subject_id,unit_no,title) VALUES (?,?,?)').run(sid, u.no, u.title);
        const uid = db.prepare('SELECT id FROM syllabus_units WHERE subject_id=? AND unit_no=?').get(sid, u.no).id;
        for (const t of u.topics) n += db.prepare("INSERT OR IGNORE INTO topics(unit_id,subject_id,name,difficulty) VALUES (?,?,?,'medium')").run(uid, sid, t).changes;
      }
      log('imported', `${units.length} units, ${n} topics`);
      return { subject_id: sid, units: units.length, topics: n, verification_status: verification, note: 'Difficulty defaults to medium. Review the parsed topics against the PDF.' };
    })();
  }
  throw new ImportError('Unknown import type.');
}

module.exports = { importPdf, download, extractQuestions, parseSyllabus, mapQuestion, ImportError, UPLOAD_DIR };
