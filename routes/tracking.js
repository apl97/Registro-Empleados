const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/database');

const router = express.Router();

// SECURITY: Rate limiting for public endpoint
const trackingAttempts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30; // 30 requests per minute per IP
const LOCKOUT_THRESHOLD = 100; // After 100 requests, lockout for longer
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minute lockout

function checkTrackingRateLimit(ip) {
  const now = Date.now();
  const record = trackingAttempts.get(ip);

  if (!record) {
    trackingAttempts.set(ip, { count: 1, windowStart: now, locked: false });
    return { allowed: true };
  }

  // Check if currently locked out
  if (record.locked && now - record.windowStart < LOCKOUT_TIME) {
    return { allowed: false, lockedOut: true };
  }

  // Reset window if expired
  if (now - record.windowStart > RATE_LIMIT_WINDOW) {
    record.count = 1;
    record.windowStart = now;
    record.locked = false;
    return { allowed: true };
  }

  record.count++;

  // Check for lockout threshold
  if (record.count > LOCKOUT_THRESHOLD) {
    record.locked = true;
    record.windowStart = now;
    return { allowed: false, lockedOut: true };
  }

  // Check rate limit
  if (record.count > MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, lockedOut: false };
  }

  return { allowed: true };
}

// SECURITY: Validate UUID format (basic check for token security)
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// SECURITY: Validate employee reference token (opaque identifier)
// Now expects a hashed/signed reference instead of plain ID
function isValidEmployeeRef(ref) {
  // Accept either old-style numeric IDs (for backwards compatibility) or new signed tokens
  // New format: base64url encoded, 32+ characters
  if (/^[A-Za-z0-9_-]{32,}$/.test(ref)) {
    return true;
  }
  // Legacy: numeric ID (will be deprecated)
  const num = parseInt(ref, 10);
  return !isNaN(num) && num > 0 && num.toString() === ref;
}

// SECURITY: Decode employee reference to get actual ID
// Returns null if invalid or tampered
function decodeEmployeeRef(ref, token) {
  // Try new signed format first
  if (/^[A-Za-z0-9_-]{32,}$/.test(ref)) {
    try {
      // The ref is: base64url(employeeId:hmac(token+employeeId))
      const decoded = Buffer.from(ref.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      const [idPart, signaturePart] = decoded.split(':');
      const employeeId = parseInt(idPart, 10);

      if (isNaN(employeeId) || employeeId <= 0) {
        return null;
      }

      // Verify signature
      const secret = process.env.SESSION_SECRET || 'change-this-secret';
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${token}:${employeeId}`)
        .digest('hex')
        .substring(0, 16);

      if (signaturePart === expectedSignature) {
        return employeeId;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Legacy numeric ID (backwards compatible)
  const num = parseInt(ref, 10);
  if (!isNaN(num) && num > 0 && num.toString() === ref) {
    return num;
  }

  return null;
}

// Handle email link clicks (public route)
router.get('/:token/:employeeRef', async (req, res) => {
  const { token, employeeRef } = req.params;
  const clientIp = req.ip || req.connection.remoteAddress;

  // SECURITY: Rate limit check
  const rateCheck = checkTrackingRateLimit(clientIp);
  if (!rateCheck.allowed) {
    if (rateCheck.lockedOut) {
      return res.status(429).render('tracking/error', {
        message: 'Too many requests. Please try again later.'
      });
    }
    return res.status(429).render('tracking/error', {
      message: 'Please wait a moment before trying again.'
    });
  }

  // Validate input parameters to prevent injection and bad requests
  if (!isValidUUID(token)) {
    return res.render('tracking/error', {
      message: 'Invalid link format. Please use the link from your email.'
    });
  }

  if (!isValidEmployeeRef(employeeRef)) {
    return res.render('tracking/error', {
      message: 'Invalid employee reference. Please use the link from your email.'
    });
  }

  // SECURITY: Decode and verify employee reference
  const employeeId = decodeEmployeeRef(employeeRef, token);
  if (employeeId === null) {
    return res.render('tracking/error', {
      message: 'Invalid or expired link. Please use the link from your email.'
    });
  }

  const client = await pool.connect();

  try {
    // Start transaction immediately to prevent race conditions
    await client.query('BEGIN');

    // Lock the row for update to prevent concurrent clicks from recording twice
    // SELECT FOR UPDATE will block other transactions trying to read this row
    const emailResult = await client.query(
      'SELECT id, sent_date, used, used_by_employee_id FROM daily_emails WHERE token = $1 FOR UPDATE',
      [token]
    );

    if (emailResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.render('tracking/error', {
        message: 'This link is invalid or has expired. Please check for a more recent email.'
      });
    }

    const dailyEmail = emailResult.rows[0];

    // Verify employee exists and is active, get their current wage
    const employeeResult = await client.query(
      'SELECT id, first_name, last_name, daily_wage, active FROM employees WHERE id = $1',
      [employeeId]
    );

    if (employeeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.render('tracking/error', {
        message: 'Employee not found. They may have been removed from the system.'
      });
    }

    const employee = employeeResult.rows[0];

    if (!employee.active) {
      await client.query('ROLLBACK');
      return res.render('tracking/error', {
        message: 'This employee is no longer active in the system.'
      });
    }

    // Check if this employee is already registered for this date
    const existingRecord = await client.query(
      'SELECT id FROM work_records WHERE employee_id = $1 AND work_date = $2',
      [employeeId, dailyEmail.sent_date]
    );

    if (existingRecord.rows.length > 0) {
      // Already registered - just show success without inserting duplicate
      await client.query('ROLLBACK');
      return res.render('tracking/success', {
        employee: `${employee.first_name} ${employee.last_name}`,
        date: dailyEmail.sent_date
      });
    }

    // Insert work record with current wage
    await client.query(
      'INSERT INTO work_records (employee_id, work_date, wage_amount, email_token) VALUES ($1, $2, $3, $4)',
      [employeeId, dailyEmail.sent_date, employee.daily_wage || 0, token]
    );

    // Mark token as used
    await client.query(
      'UPDATE daily_emails SET used = true, used_by_employee_id = $1 WHERE id = $2',
      [employeeId, dailyEmail.id]
    );

    await client.query('COMMIT');

    res.render('tracking/success', {
      employee: `${employee.first_name} ${employee.last_name}`,
      date: dailyEmail.sent_date
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing tracking link:', error);
    res.render('tracking/error', {
      message: 'An unexpected error occurred. Please try clicking the link again, or contact support if the problem persists.'
    });
  } finally {
    client.release();
  }
});

module.exports = router;
