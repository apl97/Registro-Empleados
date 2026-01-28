const express = require('express');
const { pool } = require('../config/database');

const router = express.Router();

// Handle email link clicks (public route)
router.get('/:token/:employeeId', async (req, res) => {
  const { token, employeeId } = req.params;

  try {
    // Find the daily email with this token
    const emailResult = await pool.query(
      'SELECT id, sent_date, used, used_by_employee_id FROM daily_emails WHERE token = $1',
      [token]
    );

    if (emailResult.rows.length === 0) {
      return res.render('tracking/error', {
        message: 'Invalid or expired link'
      });
    }

    const dailyEmail = emailResult.rows[0];

    // Check if token was already used
    if (dailyEmail.used) {
      const usedByResult = await pool.query(
        'SELECT first_name, last_name FROM employees WHERE id = $1',
        [dailyEmail.used_by_employee_id]
      );
      const usedBy = usedByResult.rows[0];

      return res.render('tracking/already-used', {
        date: dailyEmail.sent_date,
        usedBy: usedBy ? `${usedBy.first_name} ${usedBy.last_name}` : 'Unknown'
      });
    }

    // Verify employee exists and is active
    const employeeResult = await pool.query(
      'SELECT id, first_name, last_name, active FROM employees WHERE id = $1',
      [employeeId]
    );

    if (employeeResult.rows.length === 0) {
      return res.render('tracking/error', {
        message: 'Employee not found'
      });
    }

    const employee = employeeResult.rows[0];

    if (!employee.active) {
      return res.render('tracking/error', {
        message: 'This employee is no longer active'
      });
    }

    // Record the work
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert work record
      await client.query(
        'INSERT INTO work_records (employee_id, work_date, email_token) VALUES ($1, $2, $3)',
        [employeeId, dailyEmail.sent_date, token]
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
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error processing tracking link:', error);
    res.render('tracking/error', {
      message: 'An error occurred. Please try again.'
    });
  }
});

module.exports = router;
