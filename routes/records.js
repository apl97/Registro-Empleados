const express = require('express');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Validate ID is a positive integer
function isValidId(id) {
  const num = parseInt(id, 10);
  return !isNaN(num) && num > 0;
}

// Validate date format (YYYY-MM-DD)
function isValidDate(dateStr) {
  if (!dateStr) return true; // Empty is OK (optional)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date);
}

router.get('/', async (req, res) => {
  const { employee_id, start_date, end_date } = req.query;

  // Validate filters
  let filterError = null;

  if (employee_id && !isValidId(employee_id)) {
    filterError = 'Invalid employee selection';
  }

  if (start_date && !isValidDate(start_date)) {
    filterError = 'Invalid start date format';
  }

  if (end_date && !isValidDate(end_date)) {
    filterError = 'Invalid end date format';
  }

  // Check date range logic
  if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
    filterError = 'Start date cannot be after end date';
  }

  try {
    let query = `
      SELECT
        wr.id,
        wr.work_date,
        wr.recorded_at,
        e.first_name,
        e.last_name
      FROM work_records wr
      JOIN employees e ON wr.employee_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // Only apply filters if no validation errors
    if (!filterError) {
      if (employee_id) {
        query += ` AND wr.employee_id = $${paramIndex}`;
        params.push(employee_id);
        paramIndex++;
      }

      if (start_date) {
        query += ` AND wr.work_date >= $${paramIndex}`;
        params.push(start_date);
        paramIndex++;
      }

      if (end_date) {
        query += ` AND wr.work_date <= $${paramIndex}`;
        params.push(end_date);
        paramIndex++;
      }
    }

    query += ' ORDER BY wr.work_date DESC, wr.recorded_at DESC';

    const recordsResult = await pool.query(query, params);
    const employeesResult = await pool.query(
      'SELECT id, first_name, last_name FROM employees ORDER BY first_name'
    );

    // Get success message from query params
    const success = req.query.success || null;

    res.render('records/index', {
      records: recordsResult.rows,
      employees: employeesResult.rows,
      filters: filterError ? {} : { employee_id, start_date, end_date },
      error: filterError,
      success
    });
  } catch (error) {
    console.error('Error fetching records:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load work records. Please try again.',
      backLink: '/dashboard',
      backText: 'Return to Dashboard'
    });
  }
});

// Delete a work record
router.post('/:id/delete', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'Invalid record ID.',
      backLink: '/records',
      backText: 'Back to Records'
    });
  }

  try {
    const result = await pool.query(
      `DELETE FROM work_records WHERE id = $1
       RETURNING employee_id, work_date`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Record not found. It may have already been deleted.',
        backLink: '/records',
        backText: 'Back to Records'
      });
    }

    // Also need to unmark the daily_email if this was the record from that token
    // (This maintains data integrity)
    await pool.query(
      `UPDATE daily_emails
       SET used = false, used_by_employee_id = NULL
       WHERE sent_date = $1 AND used_by_employee_id = $2`,
      [result.rows[0].work_date, result.rows[0].employee_id]
    );

    res.redirect('/records?success=' + encodeURIComponent('Record deleted successfully'));
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to delete record. Please try again.',
      backLink: '/records',
      backText: 'Back to Records'
    });
  }
});

module.exports = router;
