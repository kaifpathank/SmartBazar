import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, UPLOAD_DIR } from './db.js';
import { seedIfEmpty } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

// Load .env without extra dependency (Node 20+)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) { try { process.loadEnvFile(envFile); } catch { /* ignore */ } }

const JWT_SECRET = process.env.JWT_SECRET || (isProd ? null : 'dev-only-secret');
const ADMIN_SIGNUP_CODE = process.env.ADMIN_SIGNUP_CODE || (isProd ? null : 'admin123');
if (!JWT_SECRET || !ADMIN_SIGNUP_CODE) {
  console.error('JWT_SECRET and ADMIN_SIGNUP_CODE must be set in production.');
  process.exit(1);
}

seedIfEmpty();

export const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });
const sign = (u) => jwt.sign({ id: u.id, role: u.role }, JWT_SECRET, { expiresIn: '7d' });

function auth(required = true) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return required ? next(new HttpError(401, 'Please login first')) : next();
    try {
      const p = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(p.id);
      if (!user) throw new Error('no user');
      req.user = user;
      next();
    } catch {
      next(new HttpError(401, 'Session expired, please login again'));
    }
  };
}
const adminOnly = (req, res, next) =>
  req.user?.role === 'admin' ? next() : next(new HttpError(403, 'Admin access only'));

// simple in-memory rate limit for login/signup
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return next(new HttpError(429, 'Too many attempts. Try again in a few minutes.'));
    arr.push(now); hits.set(key, arr);
    next();
  };
}

// ---------- auth ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/auth/signup', limit(20, 10 * 60_000), wrap((req, res) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase();
  const phone = str(req.body.phone, 15), password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'customer';
  if (name.length < 2) throw bad('Enter your name');
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email');
  if (phone && !/^[6-9]\d{9}$/.test(phone)) throw bad('Enter a valid 10-digit mobile number');
  if (password.length < 6) throw bad('Password must be at least 6 characters');
  if (role === 'admin') {
    const code = String(req.body.adminCode || '');
    const a = Buffer.from(code), b = Buffer.from(ADMIN_SIGNUP_CODE);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(403, 'Wrong admin signup code');
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Email already registered');
  const hash = bcrypt.hashSync(password, 10);
  const id = db.prepare('INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)')
    .run(name, email, phone || null, hash, role).lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ token: sign(user), user: publicUser(user) });
}));

app.post('/api/auth/login', limit(30, 10 * 60_000), wrap((req, res) => {
  const email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) throw new HttpError(401, 'Wrong email or password');
  res.json({ token: sign(user), user: publicUser(user) });
}));

app.get('/api/auth/me', auth(), (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- catalog (public) ----------
const productSelect = `SELECT p.*, c.name AS category FROM products p JOIN categories c ON c.id = p.category_id`;

app.get('/api/categories', (req, res) => {
  res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) AS count FROM categories c ORDER BY c.id`).all());
});

app.get('/api/products', auth(false), (req, res) => {
  const where = [], args = [];
  const isAdmin = req.user?.role === 'admin' && req.query.all === '1';
  if (!isAdmin) where.push('p.active = 1');
  if (req.query.category) { where.push('p.category_id = ?'); args.push(Number(req.query.category)); }
  if (req.query.q) { where.push('(p.name LIKE ? OR p.description LIKE ?)'); const q = `%${str(req.query.q, 60)}%`; args.push(q, q); }
  const sql = `${productSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC`;
  res.json(db.prepare(sql).all(...args));
});

app.get('/api/products/:id', wrap((req, res) => {
  const p = db.prepare(`${productSelect} WHERE p.id = ?`).get(Number(req.params.id));
  if (!p || !p.active) throw new HttpError(404, 'Product not found');
  res.json(p);
}));

// ---------- admin: products ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '')),
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? cb(null, true) : cb(bad('Only JPG, PNG or WEBP photos (max 3 MB)')),
});

function readProduct(body, partial = false) {
  const out = {};
  const set = (k, v) => { out[k] = v; };
  if (!partial || body.name !== undefined) { const v = str(body.name, 120); if (v.length < 2) throw bad('Product name is required'); set('name', v); }
  if (!partial || body.description !== undefined) set('description', str(body.description, 600));
  if (!partial || body.category_id !== undefined) {
    const id = Number(body.category_id);
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id)) throw bad('Choose a valid category');
    set('category_id', id);
  }
  if (!partial || body.price !== undefined) { const v = num(body.price); if (!(v >= 0)) throw bad('Enter a valid selling price'); set('price', v); }
  if (!partial || body.mrp !== undefined) { const v = num(body.mrp); if (!(v >= 0)) throw bad('Enter a valid MRP'); set('mrp', v); }
  if (!partial || body.unit !== undefined) set('unit', str(body.unit, 30) || '1 pc');
  if (!partial || body.stock !== undefined) { const v = num(body.stock); if (!Number.isInteger(v) || v < 0) throw bad('Stock must be a whole number'); set('stock', v); }
  if (body.emoji !== undefined) set('emoji', str(body.emoji, 8) || '🛒');
  if (body.active !== undefined) set('active', body.active === true || body.active === 'true' || body.active === '1' || body.active === 1 ? 1 : 0);
  if (out.price !== undefined && out.mrp !== undefined && out.price > out.mrp) throw bad('Selling price cannot be more than MRP');
  return out;
}

app.post('/api/products', auth(), adminOnly, upload.single('image'), wrap((req, res) => {
  const f = readProduct(req.body);
  if (req.file) f.image = '/uploads/' + req.file.filename;
  const keys = Object.keys(f);
  const id = db.prepare(`INSERT INTO products (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => f[k])).lastInsertRowid;
  res.status(201).json(db.prepare(`${productSelect} WHERE p.id = ?`).get(id));
}));

app.put('/api/products/:id', auth(), adminOnly, upload.single('image'), wrap((req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!cur) throw new HttpError(404, 'Product not found');
  const f = readProduct({ price: cur.price, mrp: cur.mrp, ...req.body }, true);
  if (req.file) f.image = '/uploads/' + req.file.filename;
  if (req.body.removeImage === 'true') f.image = null;
  const keys = Object.keys(f);
  if (keys.length) db.prepare(`UPDATE products SET ${keys.map((k) => k + '=?').join(',')} WHERE id = ?`).run(...keys.map((k) => f[k]), id);
  if ((req.file || req.body.removeImage === 'true') && cur.image) fs.rm(path.join(UPLOAD_DIR, path.basename(cur.image)), () => {});
  res.json(db.prepare(`${productSelect} WHERE p.id = ?`).get(id));
}));

app.delete('/api/products/:id', auth(), adminOnly, wrap((req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT 1 FROM order_items WHERE product_id = ?').get(id);
  if (used) { db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id); return res.json({ archived: true }); }
  const cur = db.prepare('SELECT image FROM products WHERE id = ?').get(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (cur?.image) fs.rm(path.join(UPLOAD_DIR, path.basename(cur.image)), () => {});
  res.json({ deleted: true });
}));

app.post('/api/categories', auth(), adminOnly, wrap((req, res) => {
  const name = str(req.body.name, 40), emoji = str(req.body.emoji, 8) || '🛒';
  if (name.length < 2) throw bad('Category name is required');
  try {
    const id = db.prepare('INSERT INTO categories (name, emoji) VALUES (?,?)').run(name, emoji).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
  } catch { throw new HttpError(409, 'Category already exists'); }
}));

// ---------- orders ----------
const FEE_FREE_ABOVE = 499, DELIVERY_FEE = 29;
const STATUSES = ['placed', 'confirmed', 'packed', 'out_for_delivery', 'delivered', 'cancelled'];

function orderWithItems(o) {
  return { ...o, items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id) };
}

app.post('/api/orders', auth(), wrap((req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw bad('Your cart is empty');
  if (items.length > 50) throw bad('Too many items');
  const a = req.body.address || {};
  const address = { name: str(a.name, 80), phone: str(a.phone, 15), line: str(a.line, 250), pincode: str(a.pincode, 6) };
  if (address.name.length < 2) throw bad('Enter receiver name');
  if (!/^[6-9]\d{9}$/.test(address.phone)) throw bad('Enter a valid 10-digit mobile number');
  if (address.line.length < 8) throw bad('Enter full delivery address');
  if (!/^\d{6}$/.test(address.pincode)) throw bad('Enter a valid 6-digit pincode');
  const method = req.body.paymentMethod;
  if (!['cod', 'upi'].includes(method)) throw bad('Choose a payment method');

  const place = db.transaction(() => {
    let subtotal = 0; const lines = [];
    for (const it of items) {
      const qty = Number(it.qty), pid = Number(it.productId);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw bad('Invalid quantity');
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(pid);
      if (!p) throw bad('A product in your cart is no longer available');
      if (p.stock < qty) throw bad(`Only ${p.stock} left of ${p.name}`);
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, pid);
      subtotal += p.price * qty; lines.push({ p, qty });
    }
    const fee = subtotal >= FEE_FREE_ABOVE ? 0 : DELIVERY_FEE;
    const code = 'SB-' + Date.now().toString(36).toUpperCase() + crypto.randomInt(10, 99);
    const oid = db.prepare(`INSERT INTO orders (code,user_id,payment_method,payment_status,total,delivery_fee,address_name,address_phone,address_line,address_pincode)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(code, req.user.id, method, method === 'upi' ? 'paid' : 'pending', subtotal + fee, fee, address.name, address.phone, address.line, address.pincode).lastInsertRowid;
    const ins = db.prepare('INSERT INTO order_items (order_id,product_id,name,unit,price,qty) VALUES (?,?,?,?,?,?)');
    for (const { p, qty } of lines) ins.run(oid, p.id, p.name, p.unit, p.price, qty);
    return oid;
  });
  const oid = place();
  res.status(201).json(orderWithItems(db.prepare('SELECT * FROM orders WHERE id = ?').get(oid)));
}));

app.get('/api/orders', auth(), (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT o.*, u.name AS customer FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC').all()
    : db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json(rows.map(orderWithItems));
});

app.get('/api/orders/:id', auth(), wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o || (req.user.role !== 'admin' && o.user_id !== req.user.id)) throw new HttpError(404, 'Order not found');
  res.json(orderWithItems(o));
}));

app.patch('/api/orders/:id/status', auth(), adminOnly, wrap((req, res) => {
  const status = req.body.status;
  if (!STATUSES.includes(status)) throw bad('Invalid status');
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o) throw new HttpError(404, 'Order not found');
  if (['delivered', 'cancelled'].includes(o.status)) throw bad(`Order already ${o.status}`);
  db.transaction(() => {
    if (status === 'cancelled') {
      for (const it of db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id))
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.qty, it.product_id);
    }
    const paid = status === 'delivered' && o.payment_method === 'cod' ? 'paid' : o.payment_status;
    db.prepare("UPDATE orders SET status = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?").run(status, paid, o.id);
  })();
  res.json(orderWithItems(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
}));

app.post('/api/orders/:id/cancel', auth(), wrap((req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!o) throw new HttpError(404, 'Order not found');
  if (!['placed', 'confirmed'].includes(o.status)) throw bad('This order can no longer be cancelled');
  db.transaction(() => {
    for (const it of db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id))
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.qty, it.product_id);
    db.prepare("UPDATE orders SET status='cancelled', updated_at = datetime('now') WHERE id = ?").run(o.id);
  })();
  res.json(orderWithItems(db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id)));
}));

// ---------- admin stats ----------
app.get('/api/admin/stats', auth(), adminOnly, (req, res) => {
  const one = (sql) => db.prepare(sql).get();
  res.json({
    paidSales: one("SELECT COALESCE(SUM(total),0) v FROM orders WHERE payment_status='paid' AND status!='cancelled'").v,
    totalOrders: one('SELECT COUNT(*) v FROM orders').v,
    pendingOrders: one("SELECT COUNT(*) v FROM orders WHERE status IN ('placed','confirmed','packed','out_for_delivery')").v,
    customers: one("SELECT COUNT(*) v FROM users WHERE role='customer'").v,
    products: one('SELECT COUNT(*) v FROM products WHERE active=1').v,
    lowStock: db.prepare('SELECT id,name,unit,stock,emoji,image FROM products WHERE active=1 AND stock <= 5 ORDER BY stock').all(),
    topProducts: db.prepare(`SELECT oi.name, SUM(oi.qty) qty, SUM(oi.qty*oi.price) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status!='cancelled' GROUP BY oi.product_id ORDER BY qty DESC LIMIT 5`).all(),
  });
});

// ---------- frontend (production) ----------
const dist = path.join(__dirname, '..', 'public');
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
}

// ---------- errors ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be under 3 MB' : err.message });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong' : err.message });
});

const port = process.env.PORT || 4000;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(port, () => console.log(`Smart Bazar running on http://localhost:${port}`));
}
