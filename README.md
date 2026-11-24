# 🛒 Smart Bazar (web)

Supermarket app with **customer** and **admin (shopkeeper)** sides.

**Customer:** signup/login, browse + search + sort, categories, product page, cart, checkout (COD / demo UPI), order tracking, cancel order.
**Admin:** dashboard (sales, low stock, top products), order status updates, add/edit/delete products **with photo upload**, add categories.
**Safety:** passwords hashed (bcrypt), JWT login, admin only via secret signup code, stock checked and reduced inside a database transaction, prices always taken from the server.

## Run in VS Code
1. Install **Node.js 22 LTS** from nodejs.org (tick "Add to PATH"). Restart VS Code.
2. Open this folder in VS Code → Terminal → New Terminal.
3. `npm install`
4. Copy `.env.example` to `.env` and set `JWT_SECRET` and `ADMIN_SIGNUP_CODE` (in dev, defaults are `admin123` if you skip this).
5. `npm run dev`
6. Open http://localhost:4000

First run creates the database with 25 sample products.
**Make your admin:** go to Sign up → choose "Shopkeeper (Admin)" → enter your `ADMIN_SIGNUP_CODE`.

## Deploy (Render.com example)
1. Push this folder to a GitHub repo (`.env` is git-ignored, good).
2. Render → New → Web Service → connect repo. Build: `npm install`, Start: `npm start`.
3. Environment: `NODE_ENV=production`, `JWT_SECRET` (long random), `ADMIN_SIGNUP_CODE`, `DATA_DIR=/var/data`.
4. Add a **persistent disk** mounted at `/var/data`. Without it the database and uploaded photos are wiped on every deploy (free plan has no disk, fine for a demo only).

## Project layout
- `server/index.js` API (auth, products, orders, stats) · `server/db.js` schema · `server/seed.js` sample data
- `public/` frontend (plain HTML/CSS/JS, no build step)

## Ideas to extend
Real payments (Razorpay), email/SMS order updates, product reviews, delivery slots, Postgres for bigger scale.
