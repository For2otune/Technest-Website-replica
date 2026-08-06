require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Session middleware so login status persists while the server runs
app.use(session({
  secret: process.env.SESSION_SECRET || 'technest-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24, sameSite: 'lax' }, // 1 day
}));

// Static files: serve ONLY the public folder (HTML/CSS/JS/images).
// server.js, schema.sql, .env, package.json stay out of the web root.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  },
}));

// Route guard: require an authenticated admin
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated.' });
}

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'technest',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

// ---------------------------------------------------------------------------
// AUTH API
// ---------------------------------------------------------------------------

// POST /api/auth/register - create the first admin account.
// Requires the sign-up key from .env (ADMIN_SIGNUP_KEY) unless one is not set.
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, signupKey } = req.body;

  const expectedKey = process.env.ADMIN_SIGNUP_KEY;
  if (expectedKey) {
    if (signupKey !== expectedKey) {
      return res.status(403).json({ error: 'Invalid sign-up key.' });
    }
  } else {
    // Default behaviour when no key is configured: only allow one account to exist.
    const [existing] = await pool.query('SELECT COUNT(*) AS n FROM admins');
    if (existing[0].n > 0) {
      return res.status(403).json({ error: 'Registration is closed. Use an existing admin account or set ADMIN_SIGNUP_KEY in .env.' });
    }
  }

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email.trim().toLowerCase(), hash]
    );
    req.session.adminId = result.insertId;
    req.session.adminName = name;
    res.status(201).json({ id: result.insertId, name, email });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    }
    console.error('POST /api/auth/register', err.message);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// POST /api/auth/login - log in an admin
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    const [rows] = await pool.execute('SELECT * FROM admins WHERE email = ?', [email.trim().toLowerCase()]);
    const admin = rows[0];
    if (!admin) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    req.session.adminId = admin.id;
    req.session.adminName = admin.name;
    res.json({ id: admin.id, name: admin.name, email: admin.email });
  } catch (err) {
    console.error('POST /api/auth/login', err.message);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

// GET /api/auth/me - restore session (keeps you logged in)
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.json({ id: req.session.adminId, name: req.session.adminName });
  }
  res.status(401).json({ error: 'Not authenticated.' });
});

// POST /api/auth/logout - clear the session
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out.' });
    }
    res.json({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// CUSTOMER STOREFRONT AUTH API
// ---------------------------------------------------------------------------

// POST /api/customer/register - create a customer account from the storefront
app.post('/api/customer/register', async (req, res) => {
  const { name, email, phone = '', password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO customers (name, email, phone, password_hash) VALUES (?, ?, ?, ?)',
      [name, email.trim().toLowerCase(), phone, hash]
    );
    req.session.customerId = result.insertId;
    req.session.customerName = name;
    res.status(201).json({ id: result.insertId, name, email });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    }
    console.error('POST /api/customer/register', err.message);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// POST /api/customer/login - log in an existing customer
app.post('/api/customer/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    const [rows] = await pool.execute('SELECT * FROM customers WHERE email = ?', [email.trim().toLowerCase()]);
    const customer = rows[0];
    if (!customer) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const ok = await bcrypt.compare(password, customer.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    req.session.customerId = customer.id;
    req.session.customerName = customer.name;
    res.json({ id: customer.id, name: customer.name, email: customer.email });
  } catch (err) {
    console.error('POST /api/customer/login', err.message);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

// GET /api/customer/me - check storefront session
app.get('/api/customer/me', (req, res) => {
  if (req.session && req.session.customerId) {
    return res.json({ id: req.session.customerId, name: req.session.customerName });
  }
  res.status(401).json({ error: 'Not authenticated.' });
});

// POST /api/customer/logout - clear the customer session
app.post('/api/customer/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out.' });
    }
    res.json({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// CONTACT MESSAGES API
// ---------------------------------------------------------------------------

// POST /api/contact - public storefront contact form submission
app.post('/api/contact', async (req, res) => {
  const { name, email, topic = '', message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required.' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO contact_messages (name, email, topic, message) VALUES (?, ?, ?, ?)',
      [name.trim().slice(0, 190), email.trim().toLowerCase().slice(0, 190), topic.slice(0, 120), message.trim()]
    );
    res.status(201).json({ id: result.insertId, ok: true });
  } catch (err) {
    console.error('POST /api/contact', err.message);
    res.status(500).json({ error: 'Could not send your message.' });
  }
});

// GET /api/contact - list contact messages (admin only)
app.get('/api/contact', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, topic, message, created_at FROM contact_messages ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/contact failed:', err.message);
    res.status(500).json({ error: 'Could not fetch messages.' });
  }
});

// DELETE /api/contact/:id - delete a contact message (admin only)
app.delete('/api/contact/:id', requireAdmin, async (req, res) => {
  try {
    await pool.execute('DELETE FROM contact_messages WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/contact/:id', err.message);
    res.status(500).json({ error: 'Could not delete message.' });
  }
});

// Root: send to the login page (or dashboard if already logged in)
app.get('/', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.redirect('/technest-admin-dashboard.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ---------------------------------------------------------------------------
// CUSTOMERS API
// ---------------------------------------------------------------------------

// GET /api/customers - list all customers
app.get('/api/customers', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, phone, created_at FROM customers ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/customers failed:', err.message);
    res.status(500).json({ error: 'Could not fetch customers.' });
  }
});

// POST /api/customers - create a customer (password stored as bcrypt hash)
app.post('/api/customers', requireAdmin, async (req, res) => {
  const { name, email, phone = '', password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      'INSERT INTO customers (name, email, phone, password_hash) VALUES (?, ?, ?, ?)',
      [name, email.trim().toLowerCase(), phone || '', hash]
    );
    res.status(201).json({
      id: result.insertId,
      name,
      email,
      phone,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A customer with that email already exists.' });
    }
    console.error('POST /api/customers error', err.message);
    res.status(500).json({ error: 'Could not create customer.' });
  }
});

// GET /api/customers/:id - fetch a single customer
app.get('/api/customers/:id', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, phone, created_at FROM customers WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/customers/:id', err.message);
    res.status(500).json({ error: 'Could not fetch customer.' });
  }
});

// ---------------------------------------------------------------------------
// PRODUCTS API
// ---------------------------------------------------------------------------

// GET /api/products - list all products (public, read-only for the storefront)
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, category, price, stock, image, is_new, is_bestseller, created_at FROM products ORDER BY id ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/products', err.message);
    res.status(500).json({ error: 'Could not fetch products.' });
  }
});

// POST /api/products - create a product
app.post('/api/products', requireAdmin, async (req, res) => {
  const { name, category = '', price, stock = 0, image = '', is_new = 0, is_bestseller = 0 } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Product name is required.' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO products (name, category, price, stock, image, is_new, is_bestseller) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, category || '', price || 0, parseInt(stock, 10) || 0, image || '', is_new ? 1 : 0, is_bestseller ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId, name, category: category || '', price: price || 0, stock: parseInt(stock, 10) || 0, image: image || '', is_new: is_new ? 1 : 0, is_bestseller: is_bestseller ? 1 : 0 });
  } catch (err) {
    console.error('POST /api/products', err.message);
    res.status(500).json({ error: 'Could not create product.' });
  }
});

// PATCH /api/products/:id - update stock (or other fields)
app.patch('/api/products/:id', requireAdmin, async (req, res) => {
  const { name, category, price, stock, image, is_new, is_bestseller } = req.body;
  try {
    if (typeof stock !== 'undefined') {
      await pool.execute('UPDATE products SET stock = ? WHERE id = ?', [parseInt(stock, 10) || 0, req.params.id]);
    }
    if (typeof name !== 'undefined') {
      await pool.execute('UPDATE products SET name = ? WHERE id = ?', [name, req.params.id]);
    }
    if (typeof category !== 'undefined') {
      await pool.execute('UPDATE products SET category = ? WHERE id = ?', [category || '', req.params.id]);
    }
    if (typeof price !== 'undefined') {
      await pool.execute('UPDATE products SET price = ? WHERE id = ?', [price || 0, req.params.id]);
    }
    if (typeof image !== 'undefined') {
      await pool.execute('UPDATE products SET image = ? WHERE id = ?', [image || '', req.params.id]);
    }
    if (typeof is_new !== 'undefined') {
      await pool.execute('UPDATE products SET is_new = ? WHERE id = ?', [is_new ? 1 : 0, req.params.id]);
    }
    if (typeof is_bestseller !== 'undefined') {
      await pool.execute('UPDATE products SET is_bestseller = ? WHERE id = ?', [is_bestseller ? 1 : 0, req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/products/:id', err.message);
    res.status(500).json({ error: 'Could not update product.' });
  }
});

// DELETE /api/products/:id - remove a product
app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  try {
    await pool.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/products/:id', err.message);
    res.status(500).json({ error: 'Could not delete product.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`TechNest server running at http://localhost:${PORT}`);
  console.log(`Serving dashboard from ${__dirname}`);
});