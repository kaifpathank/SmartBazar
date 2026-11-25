import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');

// "Kellogg's Corn Flakes" -> "kelloggs-corn-flakes"
export const slugify = (name) =>
  name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// If public/images/<slug>.jpg|jpeg|png|webp exists, use it as the product photo.
function imageFor(name) {
  const slug = slugify(name);
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    if (fs.existsSync(path.join(IMAGES_DIR, slug + ext))) return `/images/${slug}${ext}`;
  }
  return null; // no photo -> the app shows the emoji
}

const categories = [
  ['Fruits & Vegetables', '🥬'], ['Dairy & Eggs', '🥛'], ['Staples & Grains', '🌾'],
  ['Snacks & Biscuits', '🍪'], ['Beverages', '🧃'], ['Household', '🧼'],
];

// [name, category, price, mrp, unit, stock, emoji, description]
const products = [
  ['Fresh Tomato', 0, 28, 35, '500 g', 60, '🍅', 'Farm fresh red tomatoes.'],
  ['Onion', 0, 34, 40, '1 kg', 80, '🧅', 'Good quality nashik onions.'],
  ['Potato', 0, 30, 38, '1 kg', 90, '🥔', 'Fresh potatoes, ideal for all curries.'],
  ['Banana', 0, 48, 60, '1 dozen', 40, '🍌', 'Sweet and ripe bananas.'],
  ['Apple Shimla', 0, 160, 190, '1 kg', 25, '🍎', 'Crisp, juicy apples.'],
  ['Amul Taza Milk', 1, 27, 27, '500 ml', 100, '🥛', 'Toned milk, pasteurised.'],
  ['Amul Butter', 1, 58, 58, '100 g', 50, '🧈', 'Pasteurised table butter.'],
  ['Farm Eggs', 1, 78, 90, '12 pcs', 45, '🥚', 'Fresh white eggs.'],
  ['Fresh Paneer', 1, 95, 110, '200 g', 30, '🧀', 'Soft malai paneer.'],
  ['Aashirvaad Atta', 2, 275, 310, '5 kg', 35, '🌾', 'Whole wheat flour.'],
  ['Basmati Rice', 2, 135, 160, '1 kg', 50, '🍚', 'Long grain aged basmati.'],
  ['Toor Dal', 2, 160, 185, '1 kg', 40, '🫘', 'Unpolished toor dal.'],
  ['Sunflower Oil', 2, 150, 175, '1 L', 3, '🌻', 'Refined sunflower oil.'],
  ['Sugar', 2, 48, 55, '1 kg', 70, '🍬', 'Fine crystal sugar.'],
  ['Parle-G Biscuits', 3, 10, 10, '56 g', 200, '🍪', 'Classic glucose biscuits.'],
  ['Lays Classic Salted', 3, 20, 20, '52 g', 120, '🥔', 'Crispy potato chips.'],
  ['Kellogg\'s Corn Flakes', 3, 215, 255, '475 g', 2, '🥣', 'Almond & honey corn flakes.'],
  ['Maggi Noodles', 3, 14, 14, '70 g', 150, '🍜', '2-minute masala noodles.'],
  ['Tata Tea Gold', 4, 145, 165, '250 g', 45, '🍵', 'Rich blend of tea leaves.'],
  ['Nescafe Classic', 4, 190, 220, '50 g', 30, '☕', 'Instant coffee.'],
  ['Real Mango Juice', 4, 99, 110, '1 L', 40, '🥭', 'Fruit juice drink.'],
  ['Rooh Afza Syrup', 4, 175, 195, '750 ml', 3, '🥤', 'Herbal refreshing syrup.'],
  ['Surf Excel Matic', 5, 245, 280, '1 kg', 28, '🧺', 'Detergent powder.'],
  ['Vim Dishwash Gel', 5, 99, 115, '500 ml', 35, '🧽', 'Lemon dishwash liquid.'],
  ['Colgate Toothpaste', 5, 95, 110, '200 g', 60, '🪥', 'Strong teeth, fresh breath.'],
];

export function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  if (n > 0) return false;
  const insCat = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)');
  const insProd = db.prepare(
    'INSERT INTO products (name, description, category_id, price, mrp, unit, stock, emoji, image) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  db.transaction(() => {
    const ids = categories.map(([name, emoji]) => insCat.run(name, emoji).lastInsertRowid);
    for (const [name, c, price, mrp, unit, stock, emoji, desc] of products) {
      insProd.run(name, desc, ids[c], price, mrp, unit, stock, emoji, imageFor(name));
    }
  })();
  return true;
}
