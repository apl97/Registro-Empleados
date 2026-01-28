const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { redirectIfAuthenticated } = require('../middleware/auth');

const router = express.Router();

// Simple in-memory rate limiting for login attempts
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip);

  if (!attempts) return { allowed: true };

  // Clean up old entries
  if (now - attempts.firstAttempt > LOCKOUT_TIME) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    const remainingTime = Math.ceil((LOCKOUT_TIME - (now - attempts.firstAttempt)) / 60000);
    return { allowed: false, remainingMinutes: remainingTime };
  }

  return { allowed: true };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip);

  if (!attempts) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    attempts.count++;
  }
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', redirectIfAuthenticated, async (req, res) => {
  const { username, password } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  // Check rate limit
  const rateCheck = checkRateLimit(clientIp);
  if (!rateCheck.allowed) {
    return res.render('login', {
      error: `Too many failed attempts. Please try again in ${rateCheck.remainingMinutes} minute(s).`
    });
  }

  // Validate input presence
  if (!username || !password) {
    return res.render('login', { error: 'Please enter both username and password.' });
  }

  // Trim and validate length
  const trimmedUsername = username.trim();
  if (trimmedUsername.length === 0 || trimmedUsername.length > 255) {
    recordFailedAttempt(clientIp);
    return res.render('login', { error: 'Invalid username or password' });
  }

  try {
    const result = await pool.query(
      'SELECT id, password_hash FROM users WHERE username = $1',
      [trimmedUsername]
    );

    if (result.rows.length === 0) {
      recordFailedAttempt(clientIp);
      return res.render('login', { error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      recordFailedAttempt(clientIp);
      return res.render('login', { error: 'Invalid username or password' });
    }

    // Success - clear attempts and create session
    clearAttempts(clientIp);

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.render('login', { error: 'An error occurred. Please try again.' });
      }

      req.session.userId = user.id;
      req.session.username = trimmedUsername;
      res.redirect('/dashboard');
    });
  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'An error occurred. Please try again.' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    // Clear cookie as well
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;
