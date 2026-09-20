'use strict';
const bcrypt = require('bcryptjs');
const { db, tx, uniqueSlug } = require('./db');
const { IS_PROD } = require('./config');

const ADMIN_EMAIL = 'admin@azhars.pk';
const ADMIN_PASSWORD = 'Admin@12345';

const HEX = { Black: '2A2730', Tan: 'B98A5E', Brown: '6B4630', Burgundy: '6E2A3A', Sage: '8FA88A', Lilac: 'B9A6E6', Ivory: 'EFE9DD', Navy: '2D3A5C' };

const CATEGORIES = [
  ['Formal', 'formal', 'Oxfords, derbies and loafers for the office and occasions.'],
  ['Sneakers', 'sneakers', 'Clean leather sneakers for every day.'],
  ['Boots', 'boots', 'Chelsea and desert boots that age beautifully.'],
  ['Sandals & Chappals', 'sandals', 'Handmade chappals and leather sandals.'],
  ['Wallets', 'wallets', 'Slim wallets and card holders.'],
  ['Belts', 'belts', 'Full-grain leather belts.'],
  ['Bags', 'bags', 'Totes, messengers and weekenders.'],
  ['Shoe Care', 'shoe-care', 'Polish, brushes and shoe trees.']
];
const KIND = { formal: 'oxford', sneakers: 'sneaker', boots: 'boot', sandals: 'sandal', wallets: 'wallet', belts: 'belt', bags: 'bag', 'shoe-care': 'care' };

const SHOE_SIZES = ['39', '40', '41', '42', '43', '44', '45'];
// [name, category slug, base price, colors, sizes, description, material, featured]
const PRODUCTS = [
  ['Kasur Oxford', 'formal', 18900, ['Black', 'Brown'], SHOE_SIZES, 'A clean-toed oxford with a softly padded collar. Made for long days and longer evenings.', 'Full-grain calf leather', 1],
  ['Mall Road Derby', 'formal', 16500, ['Tan', 'Burgundy'], SHOE_SIZES, 'Open-laced derby that pairs with a suit or a plain tee.', 'Full-grain leather, leather lining', 0],
  ['Lahori Loafer', 'formal', 14900, ['Black', 'Tan', 'Burgundy'], SHOE_SIZES, 'Slip-on loafer with a flexible sole. No laces, no fuss.', 'Calf leather', 1],
  ['Lilac Court Sneaker', 'sneakers', 12900, ['Lilac', 'Ivory'], SHOE_SIZES, 'Minimal court sneaker in soft leather with a cushioned insole.', 'Nappa leather', 1],
  ['Sage Everyday Sneaker', 'sneakers', 11900, ['Sage', 'Ivory'], SHOE_SIZES, 'Low-profile leather sneaker that goes with everything.', 'Nappa leather', 1],
  ['Riverside Runner', 'sneakers', 13900, ['Navy', 'Black'], SHOE_SIZES, 'Sporty silhouette, leather upper, lightweight sole.', 'Leather and mesh', 0],
  ['Chelsea Boot', 'boots', 21900, ['Black', 'Brown'], SHOE_SIZES, 'Pull-on Chelsea with elastic gussets and a stacked heel.', 'Full-grain leather', 1],
  ['Desert Boot', 'boots', 17900, ['Tan', 'Brown'], SHOE_SIZES, 'Ankle-high lace-up boot with a crepe-feel sole.', 'Suede-finish leather', 0],
  ['Peshawari Chappal', 'sandals', 6900, ['Brown', 'Tan', 'Black'], SHOE_SIZES, 'The classic, stitched by hand and softened for everyday wear.', 'Vegetable-tanned leather', 1],
  ['Strap Sandal', 'sandals', 7900, ['Tan', 'Sage'], SHOE_SIZES, 'Two-strap leather sandal with a padded footbed.', 'Leather', 0],
  ['Slim Bifold Wallet', 'wallets', 4200, ['Black', 'Brown', 'Burgundy'], [], 'Six card slots, one note pocket, almost no bulk.', 'Full-grain leather', 1],
  ['Card Holder', 'wallets', 2800, ['Sage', 'Lilac', 'Black'], [], 'Four slots and a middle pocket. Fits a front pocket.', 'Nappa leather', 0],
  ['Everyday Leather Belt', 'belts', 3600, ['Black', 'Brown', 'Tan'], ['30', '32', '34', '36', '38', '40'], 'A 3.5 cm belt with a brushed metal buckle.', 'Full-grain leather', 0],
  ['Weekender Tote', 'bags', 19900, ['Tan', 'Black'], [], 'Roomy tote with a zip top and a padded laptop sleeve.', 'Full-grain leather, cotton lining', 1],
  ['Laptop Messenger', 'bags', 16900, ['Brown', 'Black'], [], 'Fits a 15" laptop. Adjustable strap, magnetic flap.', 'Full-grain leather', 0],
  ['Leather Care Kit', 'shoe-care', 2400, ['Neutral'], [], 'Cream polish, horsehair brush and a soft cloth.', 'Wax, horsehair, cotton', 0]
];

// Returns: true (created), 'reset', 'missing' (online and no ADMIN_* variables), or false (nothing to do)
function seedAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = String(process.env.ADMIN_PASSWORD || '');
  const first = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (first) {
    if (process.env.ADMIN_RESET === 'true' && email && pw.length >= 10) {
      try {
        db.prepare('UPDATE users SET email = ?, password_hash = ?, must_change = 0 WHERE id = ?').run(email, bcrypt.hashSync(pw, 10), first.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(first.id);
        return 'reset';
      } catch { return false; }
    }
    return false;
  }
  if (IS_PROD) {
    if (!email || pw.length < 10) return 'missing';
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) db.prepare("UPDATE users SET role = 'admin', password_hash = ?, must_change = 0 WHERE id = ?").run(bcrypt.hashSync(pw, 10), existing.id);
    else db.prepare('INSERT INTO users (name, email, password_hash, role, must_change) VALUES (?,?,?,?,0)').run('Store Owner', email, bcrypt.hashSync(pw, 10), 'admin');
    return true;
  }
  db.prepare('INSERT INTO users (name, email, password_hash, role, must_change) VALUES (?,?,?,?,1)')
    .run('Store Admin', ADMIN_EMAIL, bcrypt.hashSync(ADMIN_PASSWORD, 10), 'admin');
  return true;
}

// The eight starter categories (empty of products). Safe to run every start; only fills an empty table.
function seedCategories() {
  if (db.prepare('SELECT COUNT(*) n FROM categories').get().n > 0) return false;
  CATEGORIES.forEach(([name, slug, desc], i) => {
    db.prepare('INSERT INTO categories (name, slug, description, image, sort_order) VALUES (?,?,?,?,?)').run(name, slug, desc, '', i);
  });
  return true;
}

function seedDemo() {
  if (db.prepare('SELECT COUNT(*) n FROM products').get().n > 0) return false;
  tx(() => {
    seedCategories();
    const catId = {};
    db.prepare('SELECT id, slug FROM categories').all().forEach(c => { catId[c.slug] = c.id; });
    PRODUCTS.forEach(([name, cat, price, colors, sizes, desc, material, featured], idx) => {
      const p = db.prepare('INSERT INTO products (name, slug, description, category_id, base_price, brand, material, featured, active, tags) VALUES (?,?,?,?,?,?,?,?,1,?)')
        .run(name, uniqueSlug('products', name), desc, catId[cat], price, 'AZHARS', material, featured, cat);
      const pid = p.lastInsertRowid;
      const hex1 = HEX[colors[0]] || '8A6A50';
      const hex2 = HEX[colors[1] || colors[0]] || '8A6A50';
      db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?,?,0)').run(pid, `/img/ph/${KIND[cat]}.svg?c=${hex1}&bg=lav`);
      db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?,?,1)').run(pid, `/img/ph/${KIND[cat]}.svg?c=${hex2}&bg=sage`);
      const sizeList = sizes.length ? sizes : [''];
      let n = 0;
      for (const color of colors) {
        for (const size of sizeList) {
          n++;
          const stock = (idx + n) % 19 === 0 ? 0 : 3 + ((idx * 7 + n * 3) % 12);
          const sku = `AZ-${String(pid).padStart(3, '0')}-${color.slice(0, 2).toUpperCase()}${size ? '-' + size : ''}`;
          db.prepare('INSERT INTO variants (product_id, sku, size, color, price_override, stock, active) VALUES (?,?,?,?,NULL,?,1)')
            .run(pid, sku, size, color === 'Neutral' ? '' : color, stock);
        }
      }
    });
    // an example sale (scheduled off by default so you can see how it works)
    const ends = new Date(Date.now() + 14 * 864e5).toISOString();
    db.prepare(`INSERT INTO sales (name, banner_text, discount_type, discount_value, scope, category_id, product_ids, starts_at, ends_at, active)
      VALUES (?,?,?,?,?,?,?,?,?,1)`).run('Sneaker Season', 'Sneaker Season: 20% off every sneaker', 'percent', 20, 'category', catId['sneakers'], '[]', new Date(Date.now() - 864e5).toISOString(), ends);
    db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order, active) VALUES (?,?,?,?,1)').run('WELCOME10', 'percent', 10, 5000);
  });
  return true;
}

module.exports = { seedAdmin, seedDemo, seedCategories, ADMIN_EMAIL, ADMIN_PASSWORD };
