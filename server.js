require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const db = require('./src/db');
const { seedDemo } = require('./src/seed');
const { UPLOAD_DIR } = require('./src/importer');

if (!db.prepare('SELECT 1 FROM subjects LIMIT 1').get()) seedDemo(db);

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use('/api', require('./src/routes'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/uploads', express.static(UPLOAD_DIR, { index: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err && err.name === 'ImportError') return res.status(422).json({ error: err.message });
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => console.log(`Smart Study Planner running at http://localhost:${PORT}`));
module.exports = app;
