const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const PORT = process.env.PORT || 3000;

// ---------- Database ----------
const db = new Database(path.join(__dirname, 'blog.db'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);`);

// ---------- App & middleware ----------
const app = express();
app.use(helmet());
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

const clean = (s) => (typeof s === 'string' ? s.trim() : '');
const sign = (u) => jwt.sign({ id: u.id, username: u.username }, SECRET, { expiresIn: '7d' });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Please log in to continue.' }); }
}

// ---------- Auth ----------
app.post('/api/auth/register', authLimiter, (req, res) => {
  const username = clean(req.body.username), email = clean(req.body.email).toLowerCase(), password = req.body.password;
  if (!/^[\w.-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-30 letters, numbers, dots, dashes or underscores.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(username, email))
    return res.status(409).json({ error: 'That username or email is already registered.' });
  const info = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run(username, email, bcrypt.hashSync(password, 10));
  const user = { id: info.lastInsertRowid, username };
  res.status(201).json({ token: sign(user), user });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash))
    return res.status(401).json({ error: 'Incorrect email or password.' });
  const user = { id: u.id, username: u.username };
  res.json({ token: sign(user), user });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

// ---------- Posts ----------
const POST_SELECT = `SELECT p.id, p.title, p.content, p.created_at, p.updated_at, p.user_id, u.username AS author,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
  FROM posts p JOIN users u ON u.id = p.user_id`;

app.get('/api/posts', (req, res) => {
  const q = `%${clean(req.query.q)}%`;
  const page = Math.max(1, parseInt(req.query.page) || 1), size = 10;
  const posts = db.prepare(`${POST_SELECT} WHERE p.title LIKE ? OR p.content LIKE ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?`)
    .all(q, q, size, (page - 1) * size);
  const total = db.prepare('SELECT COUNT(*) n FROM posts WHERE title LIKE ? OR content LIKE ?').get(q, q).n;
  res.json({ posts, page, pages: Math.max(1, Math.ceil(total / size)) });
});

app.get('/api/posts/:id', (req, res) => {
  const post = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  post.comments = db.prepare(`SELECT c.id, c.body, c.created_at, c.user_id, u.username AS author
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC`).all(req.params.id);
  res.json(post);
});

function validatePost(req, res) {
  const title = clean(req.body.title), content = clean(req.body.content);
  if (title.length < 3 || title.length > 150) { res.status(400).json({ error: 'Title must be 3-150 characters.' }); return null; }
  if (content.length < 10 || content.length > 20000) { res.status(400).json({ error: 'Content must be 10-20,000 characters.' }); return null; }
  return { title, content };
}

app.post('/api/posts', auth, (req, res) => {
  const v = validatePost(req, res); if (!v) return;
  const info = db.prepare('INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)').run(req.user.id, v.title, v.content);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.put('/api/posts/:id', auth, (req, res) => {
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own posts.' });
  const v = validatePost(req, res); if (!v) return;
  db.prepare('UPDATE posts SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(v.title, v.content, req.params.id);
  res.json({ id: Number(req.params.id) });
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own posts.' });
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Comments ----------
app.post('/api/posts/:id/comments', auth, (req, res) => {
  if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Post not found.' });
  const body = clean(req.body.body);
  if (body.length < 1 || body.length > 1000) return res.status(400).json({ error: 'Comment must be 1-1,000 characters.' });
  const info = db.prepare('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)').run(req.params.id, req.user.id, body);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/comments/:id', auth, (req, res) => {
  const c = db.prepare(`SELECT c.user_id, p.user_id AS post_owner FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?`).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Comment not found.' });
  if (c.user_id !== req.user.id && c.post_owner !== req.user.id) return res.status(403).json({ error: 'You cannot delete this comment.' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: 'Something went wrong.' }));

app.listen(PORT, () => console.log(`Blog running at http://localhost:${PORT}`));
