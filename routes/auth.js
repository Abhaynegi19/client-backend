const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const sign = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email });

// Basic brute-force protection: 10 failed attempts per IP per 15 minutes
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
const tooMany = (ip) => {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW);
  attempts.set(ip, list);
  return list.length >= 10;
};
const fail = (ip) => attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);

router.post('/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }
  if (await User.findOne({ email: String(email || '').toLowerCase() })) {
    return res.status(409).json({ message: 'An account with this email already exists' });
  }
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 12) });
  res.status(201).json({ token: sign(user), user: publicUser(user) });
}));

router.post('/login', wrap(async (req, res) => {
  if (tooMany(req.ip)) {
    return res.status(429).json({ message: 'Too many attempts. Try again in a few minutes' });
  }
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email || '').toLowerCase() }).select('+password');
  const ok = user && (await bcrypt.compare(String(password || ''), user.password));
  if (!ok) {
    fail(req.ip);
    return res.status(401).json({ message: 'Incorrect email or password' });
  }
  res.json({ token: sign(user), user: publicUser(user) });
}));

router.get('/me', auth, wrap(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ message: 'Account not found. Please log in again' });
  res.json(publicUser(user));
}));

module.exports = router;
