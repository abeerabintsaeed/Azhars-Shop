'use strict';
// Bulk product upload: one CSV row per variant (size/colour). Rows with the same product name are grouped.
const { db, tx, slugify, uniqueSlug } = require('./db');

const COLUMNS = ['name', 'category', 'description', 'brand', 'material', 'tags', 'featured', 'active', 'price', 'image_urls', 'size', 'color', 'sku', 'stock', 'variant_price'];

function parseCSV(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim() !== '')) rows.push(row);
  return rows;
}
const csvCell = v => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCSV = rows => '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function template() {
  return toCSV([
    COLUMNS,
    ['Kasur Oxford', 'Formal', 'Classic oxford in full-grain leather.', 'AZHARS', 'Full-grain leather', 'formal;office', 'yes', 'yes', 18900, 'kasur-oxford-1.jpg|kasur-oxford-2.jpg', '41', 'Black', 'KO-BLK-41', 6, ''],
    ['Kasur Oxford', '', '', '', '', '', '', '', '', '', '42', 'Black', 'KO-BLK-42', 4, ''],
    ['Kasur Oxford', '', '', '', '', '', '', '', '', '', '42', 'Brown', 'KO-BRN-42', 3, 19500],
    ['Slim Bifold Wallet', 'Wallets', 'Six card slots, one note pocket.', 'AZHARS', 'Full-grain leather', 'wallet', 'no', 'yes', 4200, 'https://example.com/wallet.jpg', '', 'Black', 'WB-BLK', 25, '']
  ]);
}

function exportProducts() {
  const rows = [COLUMNS];
  const products = db.prepare(`SELECT p.*, c.name AS cat FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id`).all();
  for (const p of products) {
    const imgs = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order, id').all(p.id).map(i => i.url).join('|');
    const vs = db.prepare('SELECT * FROM variants WHERE product_id = ? ORDER BY id').all(p.id);
    (vs.length ? vs : [null]).forEach((v, i) => {
      rows.push(i === 0
        ? [p.name, p.cat || '', p.description, p.brand, p.material, p.tags, p.featured ? 'yes' : 'no', p.active ? 'yes' : 'no', p.base_price, imgs, v ? v.size : '', v ? v.color : '', v ? v.sku : '', v ? v.stock : 0, v && v.price_override != null ? v.price_override : '']
        : [p.name, '', '', '', '', '', '', '', '', '', v.size, v.color, v.sku, v.stock, v.price_override != null ? v.price_override : '']);
    });
  }
  return toCSV(rows);
}

const yes = v => /^(1|y|yes|true|on)$/i.test(String(v || '').trim());
const normImage = u => {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^(https?:)?\/\//i.test(u) || u.startsWith('/')) return u;
  return '/uploads/' + u.replace(/^\.?\/?/, '');
};

// Validate + (optionally) write. dry=true only reports what would happen.
function processBulk(csvText, dry) {
  const table = parseCSV(csvText);
  const result = { created: 0, updated: 0, variants: 0, categories_created: [], errors: [], warnings: [], preview: [] };
  if (table.length < 2) { result.errors.push({ row: 0, message: 'The file has no product rows. Download the template and fill it in.' }); return result; }
  const header = table[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  for (const need of ['name', 'price']) {
    if (!header.includes(need)) { result.errors.push({ row: 1, message: `Missing column "${need}". Start from the template.` }); }
  }
  if (result.errors.length) return result;

  const groups = new Map();
  table.slice(1).forEach((cells, i) => {
    const rowNo = i + 2, r = {};
    header.forEach((h, k) => { r[h] = (cells[k] || '').trim(); });
    if (!r.name) { result.errors.push({ row: rowNo, message: 'Product name is empty.' }); return; }
    const key = r.name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { first: r, firstRow: rowNo, rows: [] });
    groups.get(key).rows.push({ r, rowNo });
  });

  const plans = [];
  for (const g of groups.values()) {
    const f = g.first;
    const price = parseInt(String(f.price).replace(/[^\d]/g, ''), 10);
    const existing = db.prepare('SELECT * FROM products WHERE slug = ? OR lower(name) = ?').get(slugify(f.name), f.name.toLowerCase());
    if (!existing && (Number.isNaN(price) || !f.price)) { result.errors.push({ row: g.firstRow, message: `"${f.name}": price is missing or not a number.` }); continue; }
    if (!existing && !f.category) { result.errors.push({ row: g.firstRow, message: `"${f.name}": category is missing on the first row.` }); continue; }
    const variants = [];
    let bad = false;
    for (const { r, rowNo } of g.rows) {
      const stock = r.stock === '' ? 0 : parseInt(r.stock, 10);
      if (Number.isNaN(stock) || stock < 0) { result.errors.push({ row: rowNo, message: `"${f.name}": stock must be a whole number (0 or more).` }); bad = true; continue; }
      let vp = null;
      if (r.variant_price !== '') {
        vp = parseInt(String(r.variant_price).replace(/[^\d]/g, ''), 10);
        if (Number.isNaN(vp)) { result.errors.push({ row: rowNo, message: `"${f.name}": variant_price must be a number.` }); bad = true; continue; }
      }
      // a row with no size/colour/sku/stock only carries product-level info (e.g. a price change)
      const blank = !r.size && !r.color && !r.sku && r.stock === '' && r.variant_price === '';
      if (!blank) variants.push({ size: r.size, color: r.color, sku: r.sku, stock, price_override: vp });
    }
    if (bad) continue;
    if (!variants.length && !existing) variants.push({ size: '', color: '', sku: '', stock: 0, price_override: null });
    plans.push({ f, price, existing, variants });
  }

  const knownCats = new Set(db.prepare('SELECT lower(name) n FROM categories').all().map(c => c.n));
  const newCats = new Set();
  for (const p of plans) {
    if (p.f.category && !knownCats.has(p.f.category.toLowerCase())) newCats.add(p.f.category);
    result[p.existing ? 'updated' : 'created']++;
    result.variants += p.variants.length;
    if (result.preview.length < 8) result.preview.push({ name: p.f.name, action: p.existing ? 'update' : 'create', variants: p.variants.length, price: p.price || (p.existing && p.existing.base_price) });
  }
  result.categories_created = [...newCats];
  if (dry || (result.errors.length && !plans.length)) return result;

  tx(() => {
    for (const p of plans) {
      const f = p.f;
      let catId = p.existing ? p.existing.category_id : null;
      if (f.category) {
        let c = db.prepare('SELECT id FROM categories WHERE lower(name) = ? OR slug = ?').get(f.category.toLowerCase(), slugify(f.category));
        if (!c) {
          const r = db.prepare('INSERT INTO categories (name, slug, sort_order) VALUES (?,?,99)').run(f.category, uniqueSlug('categories', f.category));
          c = { id: r.lastInsertRowid };
        }
        catId = c.id;
      }
      let pid;
      if (p.existing) {
        pid = p.existing.id;
        db.prepare('UPDATE products SET category_id=?, description=?, brand=?, material=?, tags=?, base_price=?, featured=?, active=? WHERE id=?').run(
          catId, f.description || p.existing.description, f.brand || p.existing.brand, f.material || p.existing.material,
          f.tags ? f.tags.replace(/;/g, ',') : p.existing.tags, Number.isNaN(p.price) ? p.existing.base_price : p.price,
          f.featured ? (yes(f.featured) ? 1 : 0) : p.existing.featured, f.active ? (yes(f.active) ? 1 : 0) : p.existing.active, pid);
      } else {
        pid = db.prepare('INSERT INTO products (name, slug, description, category_id, base_price, brand, material, tags, featured, active) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
          f.name, uniqueSlug('products', f.name), f.description, catId, p.price, f.brand, f.material, f.tags.replace(/;/g, ','), yes(f.featured) ? 1 : 0, f.active === '' ? 1 : (yes(f.active) ? 1 : 0)).lastInsertRowid;
      }
      const imgs = (f.image_urls || '').split('|').map(normImage).filter(Boolean);
      if (imgs.length) {
        db.prepare('DELETE FROM product_images WHERE product_id = ?').run(pid);
        imgs.forEach((u, i) => db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?,?,?)').run(pid, u, i));
      }
      for (const v of p.variants) {
        let ex = null;
        if (v.sku) ex = db.prepare('SELECT id FROM variants WHERE product_id = ? AND sku = ?').get(pid, v.sku);
        if (!ex) ex = db.prepare('SELECT id FROM variants WHERE product_id = ? AND size = ? AND color = ? AND sku = ?').get(pid, v.size, v.color, v.sku || '');
        if (ex) db.prepare('UPDATE variants SET size=?, color=?, sku=?, stock=?, price_override=?, active=1 WHERE id=?').run(v.size, v.color, v.sku, v.stock, v.price_override, ex.id);
        else db.prepare('INSERT INTO variants (product_id, sku, size, color, price_override, stock, active) VALUES (?,?,?,?,?,?,1)').run(pid, v.sku, v.size, v.color, v.price_override, v.stock);
      }
    }
  });
  return result;
}

module.exports = { processBulk, template, exportProducts, parseCSV };
