'use strict';
// ---------------------------------------------------------------------------
// AZHARS - database + store logic (SQLite, built into Node - nothing to install)
// ---------------------------------------------------------------------------
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { DATA_DIR, IS_PROD } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'azhars.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  base_price INTEGER NOT NULL DEFAULT 0,
  brand TEXT DEFAULT '',
  material TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT DEFAULT '',
  size TEXT DEFAULT '',
  color TEXT DEFAULT '',
  price_override INTEGER,
  stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  banner_text TEXT DEFAULT '',
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value INTEGER NOT NULL DEFAULT 10,
  scope TEXT NOT NULL DEFAULT 'all',
  category_id INTEGER,
  product_ids TEXT DEFAULT '[]',
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value INTEGER NOT NULL DEFAULT 10,
  min_order INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  user_id INTEGER,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  province TEXT DEFAULT '',
  postal TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  subtotal INTEGER NOT NULL,
  coupon_code TEXT DEFAULT '',
  coupon_discount INTEGER NOT NULL DEFAULT 0,
  shipping INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  payment_ref TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  tracking TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  variant_id INTEGER,
  name TEXT NOT NULL,
  variant_label TEXT DEFAULT '',
  image TEXT DEFAULT '',
  unit_price INTEGER NOT NULL,
  original_price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_variants_prod ON variants(product_id);
CREATE INDEX IF NOT EXISTS idx_images_prod ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
`);

// ---- small helpers --------------------------------------------------------
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
const nn = v => (v === undefined ? null : v);
const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'item';
function uniqueSlug(table, base, ignoreId = 0) {
  let slug = slugify(base), n = 1;
  while (db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`).get(slug, ignoreId)) {
    n++; slug = slugify(base) + '-' + n;
  }
  return slug;
}

// ---- settings -------------------------------------------------------------
const DEFAULT_SETTINGS = {
  store_name: 'AZHARS',
  tagline: 'Leather shoes & accessories',
  announcement: 'Free delivery on orders over Rs. 15,000 across Pakistan',
  contact_email: 'hello@azhars.pk',
  contact_phone: '+92 300 0000000',
  address: 'Lahore, Pakistan',
  shipping_fee: 250,
  free_shipping_over: 15000,
  payment_methods: [
    { id: 'cod', label: 'Cash on delivery', enabled: true, instructions: 'Pay in cash when your order arrives.' },
    { id: 'bank', label: 'Bank transfer', enabled: true, instructions: 'Transfer the total to: Meezan Bank - Account title: AZHARS - IBAN: PK00 MEZN 0000 0000 0000 0000. Then enter the transaction ID on your order page.' },
    { id: 'jazzcash', label: 'JazzCash', enabled: true, instructions: 'Send the total to JazzCash 0300-0000000 (AZHARS). Then enter the transaction ID on your order page.' },
    { id: 'easypaisa', label: 'Easypaisa', enabled: true, instructions: 'Send the total to Easypaisa 0300-0000000 (AZHARS). Then enter the transaction ID on your order page.' },
    { id: 'card_demo', label: 'Card (test mode)', enabled: true, instructions: 'Test payment gateway - no real money moves. Replace with a live gateway before launch.' }
  ]
};
if (IS_PROD) {
  // Online, only cash on delivery is on until the owner enters real account details in Settings.
  DEFAULT_SETTINGS.payment_methods.forEach(m => { m.enabled = m.id === 'cod'; });
}
function getSettings() {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

// ---- sales & pricing ------------------------------------------------------
function activeSales() {
  const now = new Date().toISOString();
  return db.prepare(`SELECT * FROM sales WHERE active = 1
    AND (starts_at IS NULL OR starts_at = '' OR starts_at <= ?)
    AND (ends_at IS NULL OR ends_at = '' OR ends_at >= ?)`).all(now, now);
}
function saleApplies(sale, product) {
  if (sale.scope === 'all') return true;
  if (sale.scope === 'category') return product.category_id && product.category_id === sale.category_id;
  if (sale.scope === 'products') {
    try { return JSON.parse(sale.product_ids || '[]').includes(product.id); } catch { return false; }
  }
  return false;
}
function discounted(price, sale) {
  const p = sale.discount_type === 'percent' ? price * (1 - sale.discount_value / 100) : price - sale.discount_value;
  return Math.max(0, Math.round(p));
}
// best (lowest) price among all live sales - sales never stack
function priceWithSales(product, price, sales) {
  let best = { price, sale: null };
  for (const s of sales) {
    if (!saleApplies(s, product)) continue;
    const p = discounted(price, s);
    if (p < best.price) best = { price: p, sale: s };
  }
  return best;
}

// ---- products -------------------------------------------------------------
const { kindForCategory } = require('./placeholder');
function placeholderFor(categorySlug) {
  return `/img/ph/${kindForCategory(categorySlug)}.svg?c=8A6A50&bg=lav`;
}
function hydrateProducts(rows) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const marks = ids.map(() => '?').join(',');
  const variants = db.prepare(`SELECT * FROM variants WHERE product_id IN (${marks}) AND active = 1 ORDER BY id`).all(...ids);
  const images = db.prepare(`SELECT * FROM product_images WHERE product_id IN (${marks}) ORDER BY sort_order, id`).all(...ids);
  const sales = activeSales();
  const vBy = {}, iBy = {};
  variants.forEach(v => (vBy[v.product_id] ||= []).push(v));
  images.forEach(i => (iBy[i.product_id] ||= []).push(i.url));

  return rows.map(r => {
    const vs = (vBy[r.id] || []).map(v => {
      const original = v.price_override ?? r.base_price;
      const best = priceWithSales(r, original, sales);
      return { id: v.id, sku: v.sku, size: v.size, color: v.color, stock: v.stock, price: original, sale_price: best.price, sale_name: best.sale ? best.sale.name : null };
    });
    const totalStock = vs.reduce((a, v) => a + v.stock, 0);
    const inStockVs = vs.filter(v => v.stock > 0);
    const pool = inStockVs.length ? inStockVs : vs;
    const minOriginal = pool.length ? Math.min(...pool.map(v => v.price)) : r.base_price;
    const minSale = pool.length ? Math.min(...pool.map(v => v.sale_price)) : r.base_price;
    const cheapest = pool.find(v => v.sale_price === minSale);
    const onSale = minSale < (cheapest ? cheapest.price : minOriginal);
    const ref = cheapest ? cheapest.price : minOriginal;
    const imgs = iBy[r.id] || [];
    return {
      id: r.id, name: r.name, slug: r.slug, description: r.description, brand: r.brand, material: r.material,
      tags: r.tags, featured: !!r.featured, active: !!r.active, created_at: r.created_at,
      category_id: r.category_id, category_name: r.category_name, category_slug: r.category_slug,
      images: imgs, image: imgs[0] || placeholderFor(r.category_slug),
      image2: imgs[1] || null,
      variants: vs,
      sizes: [...new Set(vs.map(v => v.size).filter(Boolean))],
      colors: [...new Set(vs.map(v => v.color).filter(Boolean))],
      price: ref, sale_price: minSale, on_sale: onSale,
      percent_off: onSale ? Math.round((1 - minSale / ref) * 100) : 0,
      sale_name: cheapest ? cheapest.sale_name : null,
      in_stock: totalStock > 0, total_stock: totalStock,
      has_range: pool.some(v => v.sale_price !== minSale)
    };
  });
}
const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name, c.slug AS category_slug
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

// ---- cart pricing (single source of truth for cart page + checkout) --------
function priceCart(items, couponCode) {
  const settings = getSettings();
  const sales = activeSales();
  const lines = [], issues = [];
  for (const it of items || []) {
    const qty = Math.max(1, parseInt(it.qty, 10) || 1);
    const v = db.prepare('SELECT * FROM variants WHERE id = ? AND active = 1').get(parseInt(it.variant_id, 10));
    if (!v) { issues.push({ variant_id: it.variant_id, message: 'An item in your bag is no longer available and was removed.', remove: true }); continue; }
    const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ? AND p.active = 1`).get(v.product_id);
    if (!p) { issues.push({ variant_id: it.variant_id, message: 'An item in your bag is no longer available and was removed.', remove: true }); continue; }
    const original = v.price_override ?? p.base_price;
    const best = priceWithSales(p, original, sales);
    let q = qty;
    if (v.stock <= 0) { issues.push({ variant_id: v.id, message: `${p.name} is out of stock and was removed.`, remove: true }); continue; }
    if (q > v.stock) { q = v.stock; issues.push({ variant_id: v.id, message: `Only ${v.stock} of ${p.name} left - quantity updated.`, qty: q }); }
    const img = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order, id LIMIT 1').get(p.id);
    lines.push({
      variant_id: v.id, product_id: p.id, slug: p.slug, name: p.name,
      label: [v.color, v.size && ('Size ' + v.size)].filter(Boolean).join(' / '),
      image: img ? img.url : placeholderFor(p.category_slug),
      unit_price: best.price, original_price: original, qty: q, stock: v.stock,
      line_total: best.price * q, sale_name: best.sale ? best.sale.name : null
    });
  }
  const subtotal = lines.reduce((a, l) => a + l.line_total, 0);
  const sale_savings = lines.reduce((a, l) => a + (l.original_price - l.unit_price) * l.qty, 0);
  let coupon = null, coupon_discount = 0, coupon_error = null;
  if (couponCode) {
    const c = db.prepare('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE').get(String(couponCode).trim());
    const now = new Date().toISOString();
    if (!c || !c.active) coupon_error = 'That code is not valid.';
    else if (c.expires_at && c.expires_at < now) coupon_error = 'That code has expired.';
    else if (c.usage_limit && c.used_count >= c.usage_limit) coupon_error = 'That code has been fully redeemed.';
    else if (subtotal < c.min_order) coupon_error = `That code needs an order of at least Rs. ${c.min_order.toLocaleString('en-PK')}.`;
    else {
      coupon = c;
      coupon_discount = c.discount_type === 'percent' ? Math.round(subtotal * c.discount_value / 100) : Math.min(subtotal, c.discount_value);
    }
  }
  const afterCoupon = subtotal - coupon_discount;
  const shipping = lines.length === 0 ? 0 : (afterCoupon >= Number(settings.free_shipping_over) ? 0 : Number(settings.shipping_fee));
  return {
    lines, issues, subtotal, sale_savings, coupon_code: coupon ? coupon.code : '', coupon_discount, coupon_error,
    shipping, total: afterCoupon + shipping, free_shipping_over: Number(settings.free_shipping_over),
    coupon_row: coupon
  };
}

module.exports = {
  db, tx, nn, slugify, uniqueSlug, getSettings, setSetting, DEFAULT_SETTINGS,
  activeSales, hydrateProducts, PRODUCT_SELECT, priceCart, placeholderFor
};
