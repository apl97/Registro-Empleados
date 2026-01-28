const express = require('express');
const { pool } = require('../config/database');

const router = express.Router();

// Validate UUID format (basic check for token security)
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Validate that employeeId is a positive integer
function isValidEmployeeId(id) {
  const num = parseInt(id, 10);
  return !isNaN(num) && num > 0 && num.toString() === id;
}

// Handle email link clicks (public route)
router.get('/:token/:employeeId', async (req, res) => {
  const { token, employeeId } = req.params;

  // Validate input parameters to prevent injection and bad requests
  if (!isValidUUID(token)) {
    return res.render('tracking/error', {
      message: 'Invalid link format. Please use the link from your email.'
    });
  }

  if (!isValidEmployeeId(employeeId)) {
    return res.render('tracking/error', {
      message: 'Invalid employee reference. Please use the link from your email.'
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
