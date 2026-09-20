'use strict';
try { require('node:sqlite'); } catch (e) {
  console.log('\n  AZHARS needs a newer version of Node.js (22.13 or later; version 24 LTS recommended).');
  console.log('  Your version is ' + process.version + '. Download the latest LTS from https://nodejs.org and try again.\n');
  process.exit(1);
}
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const {
  db, tx, nn, slugify, uniqueSlug, getSettings, setSetting, activeSales,
  hydrateProducts, PRODUCT_SELECT, priceCart
} = require('./db');
const { seedAdmin, seedDemo, seedCategories, ADMIN_EMAIL, ADMIN_PASSWORD } = require('./seed');
const { IS_PROD, DATA_DIR, UPLOADS_DIR, PERSISTENT } = require('./config');
const { svg } = require('./placeholder');
const bulk = require('./bulk');

const PORT = parseInt(process.env.PORT, 10) || 3000;
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const app = express();
app.disable('x-powered-by');
if (IS_PROD) app.set('trust proxy', 1); // we sit behind Railway's HTTPS proxy
app.get('/healthz', (req, res) => res.json({ ok: true }));
if (IS_PROD) {
  app.use((req, res, next) => {
    if (req.secure) { res.set('Strict-Transport-Security', 'max-age=15552000'); return next(); }
    if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(301, 'https://' + req.headers.host + req.originalUrl);
    next();
  });
}
app.use(express.json({ limit: '12mb' }));

// ---- security headers -------------------------------------------------------
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'self'"
  });
  next();
});

// ---- helpers --------------------------------------------------------------
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isNaN(n) ? d : n; };
const str = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);
const orderNo = id => 'AZ-' + (1000 + id);
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 864e5);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(sha(token), userId, expires.toISOString());
  res.append('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${req.secure ? '; Secure' : ''}`);
}
app.use((req, res, next) => {
  req.user = null;
  const tok = parseCookies(req).sid;
  if (tok) {
    const row = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.must_change, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(tok));
    if (row && row.expires_at > new Date().toISOString()) req.user = row;
  }
  next();
});
const publicUser = u => u && ({ id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role, must_change: !!u.must_change });
const needUser = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Please log in to continue.')));
const needAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : next(new HttpError(403, 'Admin access only.')));

const attempts = new Map(); // simple login throttle
function throttle(key) {
  const now = Date.now();
  const rec = (attempts.get(key) || []).filter(t => now - t < 15 * 60 * 1000);
  if (rec.length >= 10) bad('Too many attempts. Please wait 15 minutes and try again.', 429);
  rec.push(now); attempts.set(key, rec);
}

// ---- placeholder art ------------------------------------------------------
app.get('/img/ph/:kind.svg', (req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400')
    .send(svg(req.params.kind, req.query.c, req.query.bg));
});

// ---- public: settings, categories, sales ------------------------------------
function publicSettings() {
  const s = getSettings();
  return {
    store_name: s.store_name, tagline: s.tagline, announcement: s.announcement,
    contact_email: s.contact_email, contact_phone: s.contact_phone, address: s.address,
    shipping_fee: Number(s.shipping_fee), free_shipping_over: Number(s.free_shipping_over),
    payment_methods: (s.payment_methods || []).filter(m => m.enabled).map(m => ({ id: m.id, label: m.label, instructions: m.instructions }))
  };
}
app.get('/api/settings', (req, res) => res.json(publicSettings()));

app.get('/api/categories', (req, res) => {
  res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
    FROM categories c ORDER BY c.sort_order, c.name`).all());
});
app.get('/api/sales/active', (req, res) => {
  res.json(activeSales().map(s => ({ id: s.id, name: s.name, banner_text: s.banner_text || s.name, discount_type: s.discount_type, discount_value: s.discount_value, scope: s.scope, category_id: s.category_id, ends_at: s.ends_at })));
});

// ---- public: products -------------------------------------------------------
app.get('/api/products', (req, res) => {
  const q = req.query;
  const where = ['p.active = 1'], args = [];
  if (q.category) { where.push('c.slug = ?'); args.push(String(q.category)); }
  if (q.featured) where.push('p.featured = 1');
  if (q.q) {
    where.push('(p.name LIKE ? OR p.description LIKE ? OR p.tags LIKE ? OR c.name LIKE ? OR p.material LIKE ?)');
    const like = `%${String(q.q).slice(0, 60)}%`; args.push(like, like, like, like, like);
  }
  let list = hydrateProducts(db.prepare(`${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.id DESC`).all(...args));
  if (q.sale) list = list.filter(p => p.on_sale);
  if (q.size) list = list.filter(p => p.variants.some(v => v.size === String(q.size) && v.stock > 0));
  if (q.color) list = list.filter(p => p.variants.some(v => v.color === String(q.color) && v.stock > 0));
  if (q.min) list = list.filter(p => p.sale_price >= int(q.min));
  if (q.max) list = list.filter(p => p.sale_price <= int(q.max));
  const facets = {
    sizes: [...new Set(list.flatMap(p => p.sizes))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    colors: [...new Set(list.flatMap(p => p.colors))].sort()
  };
  const sorters = {
    'price-asc': (a, b) => a.sale_price - b.sale_price,
    'price-desc': (a, b) => b.sale_price - a.sale_price,
    'name': (a, b) => a.name.localeCompare(b.name),
    'newest': (a, b) => b.id - a.id
  };
  if (sorters[q.sort]) list.sort(sorters[q.sort]);
  const total = list.length;
  const limit = Math.min(48, int(q.limit, 24) || 24), page = Math.max(1, int(q.page, 1));
  list = list.slice((page - 1) * limit, page * limit);
  res.json({ products: list, total, page, pages: Math.ceil(total / limit) || 1, facets });
});
app.get('/api/products/:slug', (req, res) => {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.slug = ? AND p.active = 1`).get(req.params.slug);
  if (!row) bad('Product not found.', 404);
  const [product] = hydrateProducts([row]);
  const related = hydrateProducts(db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.category_id IS ? AND p.id != ? ORDER BY p.featured DESC, p.id DESC LIMIT 4`).all(row.category_id, row.id));
  res.json({ product, related });
});

// ---- auth -------------------------------------------------------------------
app.post('/api/auth/register', wrap((req, res) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase(), phone = str(req.body.phone, 30), password = String(req.body.password || '');
  if (!name) bad('Please enter your name.');
  if (!emailOk(email)) bad('Please enter a valid email address.');
  if (password.length < 8) bad('Password must be at least 8 characters.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) bad('An account with this email already exists. Try logging in.');
  const id = db.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?,?,?,?)').run(name, email, phone, bcrypt.hashSync(password, 10)).lastInsertRowid;
  setSession(req, res, id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
}));
app.post('/api/auth/login', wrap((req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  throttle(req.ip + '|' + email);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) bad('Email or password is incorrect.', 401);
  setSession(req, res, u.id);
  res.json({ user: publicUser(u) });
}));
app.post('/api/auth/logout', (req, res) => {
  const tok = parseCookies(req).sid;
  if (tok) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(tok));
  res.append('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + (req.secure ? '; Secure' : ''));
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));
app.put('/api/auth/profile', needUser, wrap((req, res) => {
  const name = str(req.body.name, 80), phone = str(req.body.phone, 30);
  if (!name) bad('Please enter your name.');
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
}));
app.put('/api/auth/password', needUser, wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(req.body.current || ''), u.password_hash)) bad('Your current password is incorrect.');
  const np = String(req.body.next || '');
  if (np.length < 8) bad('New password must be at least 8 characters.');
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(bcrypt.hashSync(np, 10), u.id);
  res.json({ ok: true });
}));

// ---- cart + coupons ---------------------------------------------------------
app.post('/api/cart/price', (req, res) => {
  const r = priceCart(req.body.items, req.body.coupon);
  delete r.coupon_row;
  res.json(r);
});

// ---- orders -----------------------------------------------------------------
function loadOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return null;
  o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  o.order_no = orderNo(o.id);
  return o;
}
function canSee(o, req, token) {
  return (req.user && (req.user.role === 'admin' || req.user.id === o.user_id)) || (token && token === o.token);
}
function present(o, forAdmin) {
  const out = { ...o };
  if (!forAdmin) delete out.token;
  const pm = (getSettings().payment_methods || []).find(m => m.id === o.payment_method);
  out.payment_label = pm ? pm.label : o.payment_method;
  out.payment_instructions = pm ? pm.instructions : '';
  return out;
}

app.post('/api/orders', wrap((req, res) => {
  const b = req.body, s = getSettings();
  const contact = { name: str(b.name, 80), email: str(b.email, 120).toLowerCase(), phone: str(b.phone, 30), address: str(b.address, 300), city: str(b.city, 80), province: str(b.province, 60), postal: str(b.postal, 12), notes: str(b.notes, 400) };
  if (!contact.name) bad('Please enter your full name.');
  if (!emailOk(contact.email)) bad('Please enter a valid email address.');
  if (!/^[+\d][\d\s-]{6,}$/.test(contact.phone)) bad('Please enter a phone number we can reach you on.');
  if (!contact.address) bad('Please enter your delivery address.');
  if (!contact.city) bad('Please enter your city.');
  const method = (s.payment_methods || []).find(m => m.id === b.payment_method && m.enabled);
  if (!method) bad('Please choose a payment method.');
  if (!Array.isArray(b.items) || !b.items.length) bad('Your bag is empty.');

  const orderId = tx(() => {
    const priced = priceCart(b.items, b.coupon);
    if (!priced.lines.length) bad('Your bag is empty.');
    if (priced.issues.length) bad(priced.issues[0].message + ' Please review your bag.');
    if (b.coupon && priced.coupon_error) bad(priced.coupon_error);
    const token = crypto.randomBytes(16).toString('hex');
    const payStatus = method.id === 'cod' ? 'unpaid' : 'awaiting';
    const id = db.prepare(`INSERT INTO orders (token, user_id, name, email, phone, address, city, province, postal, notes, subtotal, coupon_code, coupon_discount, shipping, total, payment_method, payment_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(token, req.user ? req.user.id : null, contact.name, contact.email, contact.phone, contact.address, contact.city, contact.province, contact.postal, contact.notes,
      priced.subtotal, priced.coupon_code, priced.coupon_discount, priced.shipping, priced.total, method.id, payStatus).lastInsertRowid;
    for (const l of priced.lines) {
      const r = db.prepare('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?').run(l.qty, l.variant_id, l.qty);
      if (!r.changes) bad(`Sorry, ${l.name} just sold out.`);
      db.prepare('INSERT INTO order_items (order_id, product_id, variant_id, name, variant_label, image, unit_price, original_price, qty) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, l.product_id, l.variant_id, l.name, l.label, l.image, l.unit_price, l.original_price, l.qty);
    }
    if (priced.coupon_row) db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(priced.coupon_row.id);
    return id;
  });
  const o = loadOrder(orderId);
  res.json({ order: present(o, false), token: o.token });
}));
app.get('/api/orders/mine', needUser, (req, res) => {
  const rows = db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ orders: rows.map(r => present(loadOrder(r.id), false)) });
});
app.get('/api/orders/:id', wrap((req, res) => {
  const o = loadOrder(int(req.params.id));
  if (!o || !canSee(o, req, String(req.query.t || ''))) bad('Order not found.', 404);
  res.json({ order: present(o, false), demo_gateway: o.payment_method === 'card_demo' });
}));
app.post('/api/orders/:id/reference', wrap((req, res) => {
  const o = loadOrder(int(req.params.id));
  if (!o || !canSee(o, req, String(req.body.t || ''))) bad('Order not found.', 404);
  if (o.payment_status === 'paid') bad('This order is already marked as paid.');
  db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?').run(str(req.body.reference, 80), o.id);
  res.json({ ok: true });
}));
// Test-mode gateway: simulates a card payment. Replace with a real gateway before going live.
app.post('/api/orders/:id/demo-pay', wrap((req, res) => {
  const o = loadOrder(int(req.params.id));
  if (!o || !canSee(o, req, String(req.body.t || ''))) bad('Order not found.', 404);
  if (o.payment_method !== 'card_demo') bad('This order does not use the test gateway.');
  if (o.payment_status === 'paid') return res.json({ ok: true, status: 'paid' });
  if (req.body.approve) {
    db.prepare("UPDATE orders SET payment_status = 'paid', status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END, payment_ref = 'TEST-' || id WHERE id = ?").run(o.id);
    return res.json({ ok: true, status: 'paid' });
  }
  db.prepare("UPDATE orders SET payment_status = 'failed' WHERE id = ?").run(o.id);
  res.json({ ok: true, status: 'failed' });
}));
app.post('/api/subscribe', wrap((req, res) => {
  const e = str(req.body.email, 120).toLowerCase();
  if (!emailOk(e)) bad('Please enter a valid email address.');
  db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(e);
  res.json({ ok: true });
}));

// ============================================================================
// ADMIN
// ============================================================================
const admin = express.Router();
admin.use(needUser, needAdmin);

admin.get('/stats', (req, res) => {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const now = new Date();
  const since30 = new Date(now - 30 * 864e5).toISOString().slice(0, 19).replace('T', ' ');
  res.json({
    must_change: !!req.user.must_change,
    persistent: PERSISTENT,
    products: one('SELECT COUNT(*) n FROM products').n,
    customers: one("SELECT COUNT(*) n FROM users WHERE role = 'customer'").n,
    orders: one('SELECT COUNT(*) n FROM orders').n,
    pending: one("SELECT COUNT(*) n FROM orders WHERE status = 'pending'").n,
    revenue_30: one("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status != 'cancelled' AND created_at >= ?", since30).n,
    revenue_all: one("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status != 'cancelled'").n,
    unpaid_total: one("SELECT COALESCE(SUM(total),0) n FROM orders WHERE payment_status != 'paid' AND status != 'cancelled'").n,
    recent: db.prepare('SELECT id, name, total, status, payment_status, created_at FROM orders ORDER BY id DESC LIMIT 6').all().map(o => ({ ...o, order_no: orderNo(o.id) })),
    low_stock: db.prepare(`SELECT v.id, v.stock, v.size, v.color, p.name, p.id AS product_id FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.stock <= 3 AND v.active = 1 AND p.active = 1 ORDER BY v.stock, p.name LIMIT 8`).all(),
    daily: db.prepare(`SELECT substr(created_at,1,10) d, COUNT(*) n, SUM(total) t FROM orders WHERE status != 'cancelled' AND created_at >= ? GROUP BY d ORDER BY d`).all(since30)
  });
});

// --- products
function adminProduct(id) {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
  if (!row) return null;
  return {
    ...row, images: db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order, id').all(id).map(i => i.url),
    variants: db.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY id').all(id)
  };
}
admin.get('/products', (req, res) => {
  const where = [], args = [];
  if (req.query.q) { where.push('(p.name LIKE ? OR p.tags LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.category) { where.push('p.category_id = ?'); args.push(int(req.query.category)); }
  const rows = db.prepare(`${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC`).all(...args);
  const stock = {}, first = {};
  db.prepare('SELECT product_id, SUM(stock) s, COUNT(*) n FROM variants GROUP BY product_id').all().forEach(r => { stock[r.product_id] = r; });
  db.prepare('SELECT product_id, url FROM product_images WHERE sort_order = 0').all().forEach(r => { first[r.product_id] = r.url; });
  res.json(rows.map(r => ({ id: r.id, name: r.name, slug: r.slug, category_name: r.category_name, base_price: r.base_price, active: !!r.active, featured: !!r.featured, image: first[r.id] || '', stock: (stock[r.id] || {}).s || 0, variants: (stock[r.id] || {}).n || 0 })));
});
admin.get('/products/template.csv', (req, res) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="azhars-product-template.csv"' }).send(bulk.template());
});
admin.get('/products/export.csv', (req, res) => {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="azhars-products.csv"' }).send(bulk.exportProducts());
});
admin.post('/products/bulk', wrap((req, res) => {
  res.json(bulk.processBulk(req.body.csv, !!req.body.dry));
}));
admin.get('/products/:id', wrap((req, res) => {
  const p = adminProduct(int(req.params.id));
  if (!p) bad('Product not found.', 404);
  res.json(p);
}));
function saveProduct(body, id) {
  const name = str(body.name, 140);
  if (!name) bad('Product name is required.');
  const price = int(body.base_price, -1);
  if (price < 0) bad('Please enter a price (a whole number in Rs.).');
  const variants = Array.isArray(body.variants) ? body.variants : [];
  const images = (Array.isArray(body.images) ? body.images : []).map(u => str(u, 400)).filter(Boolean);
  return tx(() => {
    let pid = id;
    const cat = body.category_id ? int(body.category_id) : null;
    const f = body.featured ? 1 : 0, a = body.active === false || body.active === 0 ? 0 : 1;
    if (id) {
      db.prepare('UPDATE products SET name=?, description=?, category_id=?, base_price=?, brand=?, material=?, tags=?, featured=?, active=? WHERE id=?')
        .run(name, str(body.description, 4000), cat, price, str(body.brand, 80), str(body.material, 160), str(body.tags, 200), f, a, id);
    } else {
      pid = db.prepare('INSERT INTO products (name, slug, description, category_id, base_price, brand, material, tags, featured, active) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(name, uniqueSlug('products', name), str(body.description, 4000), cat, price, str(body.brand, 80), str(body.material, 160), str(body.tags, 200), f, a).lastInsertRowid;
    }
    db.prepare('DELETE FROM product_images WHERE product_id = ?').run(pid);
    images.forEach((u, i) => db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?,?,?)').run(pid, u, i));
    const list = variants.length ? variants : [{ size: '', color: '', sku: '', stock: 0 }];
    const keep = [];
    for (const v of list) {
      const stock = Math.max(0, int(v.stock, 0));
      const po = v.price_override === '' || v.price_override == null ? null : int(v.price_override, null);
      if (v.id && db.prepare('SELECT id FROM variants WHERE id = ? AND product_id = ?').get(int(v.id), pid)) {
        db.prepare('UPDATE variants SET sku=?, size=?, color=?, price_override=?, stock=?, active=1 WHERE id=?').run(str(v.sku, 60), str(v.size, 30), str(v.color, 40), nn(po), stock, int(v.id));
        keep.push(int(v.id));
      } else {
        keep.push(db.prepare('INSERT INTO variants (product_id, sku, size, color, price_override, stock, active) VALUES (?,?,?,?,?,?,1)').run(pid, str(v.sku, 60), str(v.size, 30), str(v.color, 40), nn(po), stock).lastInsertRowid);
      }
    }
    db.prepare(`DELETE FROM variants WHERE product_id = ? AND id NOT IN (${keep.map(() => '?').join(',')})`).run(pid, ...keep);
    return pid;
  });
}
admin.post('/products', wrap((req, res) => res.json(adminProduct(saveProduct(req.body, 0)))));
admin.put('/products/:id', wrap((req, res) => {
  const id = int(req.params.id);
  if (!adminProduct(id)) bad('Product not found.', 404);
  res.json(adminProduct(saveProduct(req.body, id)));
}));
admin.patch('/products/:id', wrap((req, res) => {
  const id = int(req.params.id);
  if ('active' in req.body) db.prepare('UPDATE products SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
  if ('featured' in req.body) db.prepare('UPDATE products SET featured = ? WHERE id = ?').run(req.body.featured ? 1 : 0, id);
  res.json({ ok: true });
}));
admin.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(int(req.params.id));
  res.json({ ok: true });
});
admin.post('/products/bulk-action', wrap((req, res) => {
  const ids = (req.body.ids || []).map(int).filter(Boolean);
  if (!ids.length) bad('Select at least one product.');
  const marks = ids.map(() => '?').join(',');
  const act = req.body.action;
  if (act === 'delete') db.prepare(`DELETE FROM products WHERE id IN (${marks})`).run(...ids);
  else if (act === 'hide') db.prepare(`UPDATE products SET active = 0 WHERE id IN (${marks})`).run(...ids);
  else if (act === 'show') db.prepare(`UPDATE products SET active = 1 WHERE id IN (${marks})`).run(...ids);
  else bad('Unknown action.');
  res.json({ ok: true });
}));

// --- image upload (JPG, PNG, WebP, GIF only)
admin.post('/upload', wrap((req, res) => {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/.exec(String(req.body.data || ''));
  if (!m) bad('Please choose a JPG, PNG, WebP or GIF image.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) bad('That image is larger than 8 MB. Please resize it.');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const base = slugify(path.parse(str(req.body.filename, 120)).name).slice(0, 60) || 'image';
  const name = req.body.keep_name ? `${base}.${ext}` : `${base}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  res.json({ url: '/uploads/' + name });
}));

// --- categories
admin.post('/categories', wrap((req, res) => {
  const name = str(req.body.name, 60);
  if (!name) bad('Category name is required.');
  const r = db.prepare('INSERT INTO categories (name, slug, description, image, sort_order) VALUES (?,?,?,?,?)')
    .run(name, uniqueSlug('categories', name), str(req.body.description, 300), str(req.body.image, 400), int(req.body.sort_order, 50));
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid));
}));
admin.put('/categories/:id', wrap((req, res) => {
  const id = int(req.params.id), name = str(req.body.name, 60);
  if (!name) bad('Category name is required.');
  db.prepare('UPDATE categories SET name=?, description=?, image=?, sort_order=? WHERE id=?').run(name, str(req.body.description, 300), str(req.body.image, 400), int(req.body.sort_order, 50), id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
}));
admin.delete('/categories/:id', wrap((req, res) => {
  const id = int(req.params.id);
  const n = db.prepare('SELECT COUNT(*) n FROM products WHERE category_id = ?').get(id).n;
  if (n) bad(`This category still has ${n} product${n > 1 ? 's' : ''}. Move or delete them first.`);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ ok: true });
}));

// --- sales
function saleBody(b) {
  const name = str(b.name, 80);
  if (!name) bad('Sale name is required.');
  const type = b.discount_type === 'fixed' ? 'fixed' : 'percent';
  const value = int(b.discount_value, 0);
  if (value <= 0) bad('Discount must be greater than zero.');
  if (type === 'percent' && value > 90) bad('Percentage discount cannot be more than 90%.');
  const scope = ['all', 'category', 'products'].includes(b.scope) ? b.scope : 'all';
  if (scope === 'category' && !b.category_id) bad('Please choose a category for this sale.');
  const pids = (Array.isArray(b.product_ids) ? b.product_ids : []).map(int).filter(Boolean);
  if (scope === 'products' && !pids.length) bad('Please choose at least one product for this sale.');
  const starts = b.starts_at ? str(b.starts_at, 40) : null, ends = b.ends_at ? str(b.ends_at, 40) : null;
  if (starts && ends && ends <= starts) bad('The sale must end after it starts.');
  return [name, str(b.banner_text, 140), type, value, scope, scope === 'category' ? int(b.category_id) : null, JSON.stringify(scope === 'products' ? pids : []), starts, ends, b.active === false ? 0 : 1];
}
admin.get('/sales', (req, res) => {
  const now = new Date().toISOString();
  res.json(db.prepare('SELECT * FROM sales ORDER BY id DESC').all().map(s => ({
    ...s, product_ids: JSON.parse(s.product_ids || '[]'),
    state: !s.active ? 'paused' : (s.starts_at && s.starts_at > now) ? 'scheduled' : (s.ends_at && s.ends_at < now) ? 'ended' : 'live'
  })));
});
admin.post('/sales', wrap((req, res) => {
  db.prepare('INSERT INTO sales (name, banner_text, discount_type, discount_value, scope, category_id, product_ids, starts_at, ends_at, active) VALUES (?,?,?,?,?,?,?,?,?,?)').run(...saleBody(req.body));
  res.json({ ok: true });
}));
admin.put('/sales/:id', wrap((req, res) => {
  db.prepare('UPDATE sales SET name=?, banner_text=?, discount_type=?, discount_value=?, scope=?, category_id=?, product_ids=?, starts_at=?, ends_at=?, active=? WHERE id=?').run(...saleBody(req.body), int(req.params.id));
  res.json({ ok: true });
}));
admin.delete('/sales/:id', (req, res) => { db.prepare('DELETE FROM sales WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); });

// --- coupons
function couponBody(b) {
  const code = str(b.code, 30).toUpperCase().replace(/\s+/g, '');
  if (!code) bad('Coupon code is required.');
  const type = b.discount_type === 'fixed' ? 'fixed' : 'percent';
  const value = int(b.discount_value, 0);
  if (value <= 0) bad('Discount must be greater than zero.');
  if (type === 'percent' && value > 90) bad('Percentage discount cannot be more than 90%.');
  return [code, type, value, Math.max(0, int(b.min_order, 0)), b.expires_at ? str(b.expires_at, 40) : null, b.usage_limit ? int(b.usage_limit) : null, b.active === false ? 0 : 1];
}
admin.get('/coupons', (req, res) => res.json(db.prepare('SELECT * FROM coupons ORDER BY id DESC').all()));
admin.post('/coupons', wrap((req, res) => {
  const a = couponBody(req.body);
  if (db.prepare('SELECT id FROM coupons WHERE code = ?').get(a[0])) bad('A coupon with that code already exists.');
  db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order, expires_at, usage_limit, active) VALUES (?,?,?,?,?,?,?)').run(...a);
  res.json({ ok: true });
}));
admin.put('/coupons/:id', wrap((req, res) => {
  db.prepare('UPDATE coupons SET code=?, discount_type=?, discount_value=?, min_order=?, expires_at=?, usage_limit=?, active=? WHERE id=?').run(...couponBody(req.body), int(req.params.id));
  res.json({ ok: true });
}));
admin.delete('/coupons/:id', (req, res) => { db.prepare('DELETE FROM coupons WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); });

// --- orders
admin.get('/orders', (req, res) => {
  const where = [], args = [];
  if (req.query.status) { where.push('status = ?'); args.push(String(req.query.status)); }
  if (req.query.q) { where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR id = ?)'); const l = `%${req.query.q}%`; args.push(l, l, l, int(String(req.query.q).replace(/\D/g, '')) - 1000); }
  const rows = db.prepare(`SELECT id, name, email, phone, city, total, status, payment_method, payment_status, created_at FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`).all(...args);
  res.json(rows.map(o => ({ ...o, order_no: orderNo(o.id) })));
});
admin.get('/orders/:id', wrap((req, res) => {
  const o = loadOrder(int(req.params.id));
  if (!o) bad('Order not found.', 404);
  res.json({ order: present(o, true) });
}));
admin.put('/orders/:id', wrap((req, res) => {
  const id = int(req.params.id), o = loadOrder(id);
  if (!o) bad('Order not found.', 404);
  const STATUS = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'], PAY = ['unpaid', 'awaiting', 'paid', 'failed', 'refunded'];
  const status = STATUS.includes(req.body.status) ? req.body.status : o.status;
  const pay = PAY.includes(req.body.payment_status) ? req.body.payment_status : o.payment_status;
  tx(() => {
    if (status === 'cancelled' && o.status !== 'cancelled') o.items.forEach(i => i.variant_id && db.prepare('UPDATE variants SET stock = stock + ? WHERE id = ?').run(i.qty, i.variant_id));
    if (o.status === 'cancelled' && status !== 'cancelled') o.items.forEach(i => i.variant_id && db.prepare('UPDATE variants SET stock = MAX(0, stock - ?) WHERE id = ?').run(i.qty, i.variant_id));
    db.prepare('UPDATE orders SET status=?, payment_status=?, tracking=? WHERE id=?').run(status, pay, str(req.body.tracking ?? o.tracking, 120), id);
  });
  res.json({ order: present(loadOrder(id), true) });
}));

// --- backup: a safe copy of the whole database (products, orders, customers)
admin.get('/backup', wrap((req, res) => {
  const tmp = path.join(DATA_DIR, `backup-${Date.now()}.tmp.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const stamp = new Date().toISOString().slice(0, 10);
  res.download(tmp, `azhars-backup-${stamp}.db`, () => fs.rm(tmp, { force: true }, () => {}));
}));

// --- customers
admin.get('/customers', (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.created_at, COUNT(o.id) AS orders, COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.total END),0) AS spent
    FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE u.role = 'customer' GROUP BY u.id ORDER BY u.id DESC`).all());
});

// --- settings
admin.get('/settings', (req, res) => res.json(getSettings()));
admin.put('/settings', wrap((req, res) => {
  const b = req.body, cur = getSettings();
  ['store_name', 'tagline', 'announcement', 'contact_email', 'contact_phone', 'address'].forEach(k => { if (k in b) setSetting(k, str(b[k], 200)); });
  if ('shipping_fee' in b) setSetting('shipping_fee', Math.max(0, int(b.shipping_fee)));
  if ('free_shipping_over' in b) setSetting('free_shipping_over', Math.max(0, int(b.free_shipping_over)));
  if (Array.isArray(b.payment_methods)) {
    const known = new Set(cur.payment_methods.map(m => m.id));
    setSetting('payment_methods', b.payment_methods.filter(m => known.has(m.id)).map(m => ({ id: m.id, label: str(m.label, 60), enabled: !!m.enabled, instructions: str(m.instructions, 600) })));
  }
  res.json(getSettings());
}));
app.use('/api/admin', admin);

// ---- static files + errors --------------------------------------------------
app.use('/uploads', express.static(UPLOADS_DIR, { setHeaders: r => r.set('Content-Disposition', 'inline') }));
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, file) => { if (/sw\.js$|manifest\.webmanifest$|index\.html$/.test(file)) res.set('Cache-Control', 'no-cache'); }
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

// ---- start ------------------------------------------------------------------
const adminResult = seedAdmin();
if (adminResult === 'missing') {
  console.log('\n  STOP: this store is running online but no admin login has been set up.');
  console.log('  In Railway, open your service > Variables and add:');
  console.log('     ADMIN_EMAIL     = the email you will log in with');
  console.log('     ADMIN_PASSWORD  = a strong password (at least 10 characters)');
  console.log('  Then it will restart by itself.\n');
  process.exit(1);
}
seedCategories();
const wantDemo = process.env.SEED_DEMO ? process.env.SEED_DEMO === 'true' : !IS_PROD;
const createdDemo = wantDemo ? seedDemo() : false;
const server = app.listen(PORT, () => {
  console.log('\n  ============================================');
  console.log('   AZHARS store is running');
  if (IS_PROD) console.log(`   Online mode, listening on port ${PORT}`);
  else {
    console.log(`   Shop:   http://localhost:${PORT}`);
    console.log(`   Admin:  http://localhost:${PORT}/#/admin`);
  }
  if (adminResult === true && !IS_PROD) {
    console.log(`   First login -> ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
    console.log('   (you will be asked to change this password)');
  }
  if (adminResult === true && IS_PROD) console.log('   Owner admin account created from your ADMIN_EMAIL / ADMIN_PASSWORD variables.');
  if (adminResult === 'reset') console.log('   Admin login was reset from your ADMIN_EMAIL / ADMIN_PASSWORD variables. Now remove ADMIN_RESET.');
  if (createdDemo) console.log('   Sample products were added. Delete them in Admin > Products.');
  console.log(`   Data folder: ${DATA_DIR}`);
  if (!PERSISTENT) {
    console.log('\n   WARNING: no permanent storage (Volume) is attached. Everything you add will be');
    console.log('   ERASED the next time this service restarts or updates. Attach a Volume in Railway.\n');
  }
  console.log('  ============================================\n');
});
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n  Port ${PORT} is already in use. The store may already be running in another window,`);
    console.log(`  or another program is using it. Close it, or start on a different port (see START-HERE.txt).\n`);
  } else console.error(err);
  process.exit(1);
});
