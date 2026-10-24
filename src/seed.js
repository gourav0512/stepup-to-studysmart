// DEMO DATA ONLY. These subjects, units, topics and questions are sample data so the app can be
// explored. They are NOT the official AKTU syllabus or question papers. Import real documents
// from the PYQ page (PDF upload / AKTU URL) to replace them.
const D = { e: 'easy', m: 'medium', h: 'hard' };

const DEMO = {
  5: [
    ['DEMO-501', 'Database Management Systems', [
      'Introduction::DBMS architecture and data models:e|ER model and diagrams:m|Keys and constraints:e',
      'Relational Model::Relational algebra:m|SQL queries and joins:m|Views and triggers:m',
      'Normalization::Functional dependencies:m|Normal forms 1NF to BCNF:h|Decomposition and lossless join:h',
      'Transactions::ACID properties:e|Serializability and schedules:h|Concurrency control and locking:h',
    ]],
    ['DEMO-502', 'Operating Systems', [
      'Introduction::OS types and services:e|System calls and structure:e|Process states and PCB:m',
      'CPU Scheduling::FCFS SJF and Round Robin:m|Priority and multilevel queue scheduling:m|Process synchronization and semaphores:h',
      'Deadlocks and Memory::Deadlock detection and avoidance:h|Paging and segmentation:m|Virtual memory and page replacement:h',
      'Storage::Disk scheduling algorithms:m|File system structure:e|RAID levels:e',
    ]],
    ['DEMO-503', 'Computer Networks', [
      'Fundamentals::OSI and TCP/IP models:e|Network topologies and devices:e|Transmission media and switching:m',
      'Data Link Layer::Error detection and correction:m|Flow control and sliding window:h|Multiple access protocols:m',
      'Network Layer::IP addressing and subnetting:h|Routing algorithms:h|Congestion control:m',
      'Transport and Application::TCP and UDP:m|DNS HTTP and SMTP:e|Network security basics:m',
    ]],
  ],
  6: [
    ['DEMO-601', 'Software Engineering', [
      'Introduction::Software process models:e|Requirements engineering:m|SRS documentation:e',
      'Design::Design principles and cohesion coupling:m|UML diagrams:m|Software architecture styles:m',
      'Testing::Black box and white box testing:m|Test levels and test cases:e|Software metrics:h',
      'Management::Project estimation COCOMO:h|Risk management:m|Software configuration management:e',
    ]],
    ['DEMO-602', 'Compiler Design', [
      'Lexical Analysis::Phases of a compiler:e|Tokens and regular expressions:m|Finite automata for lexing:m',
      'Parsing::Context free grammars:m|Top-down parsing and LL1:h|Bottom-up and LR parsing:h',
      'Semantic Analysis::Syntax directed translation:h|Symbol table organization:m|Intermediate code generation:m',
      'Optimization::Code optimization techniques:m|Code generation:h|Runtime environments:m',
    ]],
    ['DEMO-603', 'Artificial Intelligence', [
      'Introduction::Intelligent agents:e|State space search:m|Uninformed search strategies:e',
      'Heuristic Search::A star and heuristic functions:m|Adversarial search and minimax:h|Constraint satisfaction:m',
      'Knowledge::Propositional and predicate logic:h|Inference and resolution:h|Knowledge representation:m',
      'Learning::Supervised and unsupervised learning:e|Decision trees:m|Neural network basics:m',
    ]],
  ],
};

function seedDemo(db) {
  const insSub = db.prepare(`INSERT OR IGNORE INTO subjects(code,name,semester,is_demo,verification_status) VALUES (?,?,?,1,'demo')`);
  const insUnit = db.prepare('INSERT OR IGNORE INTO syllabus_units(subject_id,unit_no,title) VALUES (?,?,?)');
  const insTopic = db.prepare('INSERT OR IGNORE INTO topics(unit_id,subject_id,name,difficulty) VALUES (?,?,?,?)');
  const insPaper = db.prepare(`INSERT INTO question_papers(subject_id,exam_year,semester,pdf_url,is_demo,verification_status,file_hash)
    VALUES (?,?,?,NULL,1,'demo',?)`);
  const insQ = db.prepare('INSERT INTO extracted_questions(paper_id,q_no,text) VALUES (?,?,?)');
  const insMap = db.prepare(`INSERT OR IGNORE INTO topic_question_mapping(question_id,topic_id,confidence,status) VALUES (?,?,1,'auto')`);

  db.transaction(() => {
    for (const [sem, subjects] of Object.entries(DEMO)) {
      for (const [code, name, units] of subjects) {
        insSub.run(code, name, +sem);
        const sid = db.prepare('SELECT id FROM subjects WHERE code=? AND semester=?').get(code, +sem).id;
        const topicRows = [];
        units.forEach((u, i) => {
          const [title, list] = u.split('::');
          insUnit.run(sid, i + 1, title);
          const uid = db.prepare('SELECT id FROM syllabus_units WHERE subject_id=? AND unit_no=?').get(sid, i + 1).id;
          list.split('|').forEach((t) => {
            const [tn, d] = t.split(':');
            insTopic.run(uid, sid, tn, D[d]);
            topicRows.push(db.prepare('SELECT id,name FROM topics WHERE unit_id=? AND name=?').get(uid, tn));
          });
        });
        // Deterministic DEMO papers (2022-2024) so frequency features can be explored.
        for (const year of [2022, 2023, 2024]) {
          const hash = `demo-${code}-${year}`;
          if (db.prepare('SELECT 1 FROM question_papers WHERE file_hash=?').get(hash)) continue;
          const pid = insPaper.run(sid, year, +sem, hash).lastInsertRowid;
          let seed = sid * 131 + year;
          const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
          let picks = topicRows.filter(() => rnd() < 0.4);
          if (picks.length < 3) picks = topicRows.slice(0, 3);
          picks.forEach((t, k) => {
            const qid = insQ.run(pid, k + 1, `[DEMO] Explain ${t.name} with suitable examples.`).lastInsertRowid;
            insMap.run(qid, t.id);
          });
        }
      }
    }
  })();
}

module.exports = { seedDemo };

if (require.main === module) {
  require('dotenv').config();
  const db = require('./db');
  seedDemo(db);
  console.log('DEMO data seeded (sample data only, not official AKTU content).');
}
