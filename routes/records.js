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
  if (!dateStr) return false;
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date);
}

// Validate wage
function isValidWage(wage) {
  if (wage === undefined || wage === null || wage === '') return true;
  const num = parseFloat(wage);
  return !isNaN(num) && num >= 0;
}

// Format COP currency
function formatCOP(amount) {
  return new Intl.NumberFormat('es-CO').format(amount || 0);
}

// List records
router.get('/', async (req, res) => {
  const { employee_id, start_date, end_date } = req.query;

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

  if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
    filterError = 'Start date cannot be after end date';
  }

  try {
    let query = `
      SELECT
        wr.id,
        wr.work_date,
        wr.wage_amount,
        wr.recorded_at,
        wr.employee_id,
        e.first_name,
        e.last_name
      FROM work_records wr
      JOIN employees e ON wr.employee_id = e.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

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
      'SELECT id, first_name, last_name, daily_wage FROM employees WHERE active = true ORDER BY first_name'
    );

    const success = req.query.success || null;

    res.render('records/index', {
      records: recordsResult.rows,
      employees: employeesResult.rows,
      filters: filterError ? {} : { employee_id, start_date, end_date },
      error: filterError,
      success,
      formatCOP
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

// New record form
router.get('/new', async (req, res) => {
  try {
    const employeesResult = await pool.query(
      'SELECT id, first_name, last_name, daily_wage FROM employees WHERE active = true ORDER BY first_name'
    );
    res.render('records/new', {
      employees: employeesResult.rows,
      error: null,
      formData: { work_date: new Date().toISOString().split('T')[0] }
    });
  } catch (error) {
    console.error('Error loading new record form:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load form. Please try again.',
      backLink: '/records',
      backText: 'Back to Records'
    });
  }
});

// Create record
router.post('/', async (req, res) => {
  const { employee_id, work_date, wage_amount } = req.body;

  const getEmployees = async () => {
    const result = await pool.query(
      'SELECT id, first_name, last_name, daily_wage FROM employees WHERE active = true ORDER BY first_name'
    );
    return result.rows;
  };

  if (!employee_id || !isValidId(employee_id)) {
    const employees = await getEmployees();
    return res.render('records/new', {
      employees,
      error: 'Please select an employee',
      formData: { employee_id, work_date, wage_amount }
    });
  }

  if (!work_date || !isValidDate(work_date)) {
    const employees = await getEmployees();
    return res.render('records/new', {
      employees,
      error: 'Please enter a valid date',
      formData: { employee_id, work_date, wage_amount }
    });
  }

  if (!isValidWage(wage_amount)) {
    const employees = await getEmployees();
    return res.render('records/new', {
      employees,
      error: 'Please enter a valid wage amount',
      formData: { employee_id, work_date, wage_amount }
    });
  }

  try {
    // If wage not provided, get employee's current daily wage
    let finalWage = parseFloat(wage_amount);
    if (isNaN(finalWage) || wage_amount === '') {
      const empResult = await pool.query('SELECT daily_wage FROM employees WHERE id = $1', [employee_id]);
      finalWage = empResult.rows[0]?.daily_wage || 0;
    }

    await pool.query(
      'INSERT INTO work_records (employee_id, work_date, wage_amount) VALUES ($1, $2, $3)',
      [employee_id, work_date, finalWage]
    );
    res.redirect('/records?success=' + encodeURIComponent('Record added successfully'));
  } catch (error) {
    console.error('Error creating record:', error);
    const employees = await getEmployees();
    res.render('records/new', {
      employees,
      error: 'Unable to create record. Please try again.',
      formData: { employee_id, work_date, wage_amount }
    });
  }
});

// Edit record form
router.get('/:id/edit', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'Invalid record ID.',
      backLink: '/records',
      backText: 'Back to Records'
    });
  }

  try {
    const recordResult = await pool.query(
      `SELECT wr.*, e.first_name, e.last_name
       FROM work_records wr
       JOIN employees e ON wr.employee_id = e.id
       WHERE wr.id = $1`,
      [req.params.id]
    );

    if (recordResult.rows.length === 0) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Record not found.',
        backLink: '/records',
        backText: 'Back to Records'
      });
    }

    const employeesResult = await pool.query(
      'SELECT id, first_name, last_name, daily_wage FROM employees ORDER BY first_name'
    );

    res.render('records/edit', {
      record: recordResult.rows[0],
      employees: employeesResult.rows,
      error: null,
      formData: null
    });
  } catch (error) {
    console.error('Error loading edit form:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load record. Please try again.',
      backLink: '/records',
      backText: 'Back to Records'
    });
  }
});

// Update record
router.post('/:id', async (req, res) => {
  const { employee_id, work_date, wage_amount } = req.body;
  const id = req.params.id;

  if (!isValidId(id)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'Invalid record ID.',
      backLink: '/records',
      backText: 'Back to Records'
    });
  }

  const getFormData = async () => {
    const recordResult = await pool.query(
      `SELECT wr.*, e.first_name, e.last_name
       FROM work_records wr
       JOIN employees e ON wr.employee_id = e.id
       WHERE wr.id = $1`,
      [id]
    );
    const employeesResult = await pool.query(
      'SELECT id, first_name, last_name, daily_wage FROM employees ORDER BY first_name'
    );
    return {
      record: recordResult.rows[0],
      employees: employeesResult.rows
    };
  };

  if (!employee_id || !isValidId(employee_id)) {
    const { record, employees } = await getFormData();
    return res.render('records/edit', {
      record,
      employees,
      error: 'Please select an employee',
      formData: { employee_id, work_date, wage_amount }
    });
  }

  if (!work_date || !isValidDate(work_date)) {
    const { record, employees } = await getFormData();
    return res.render('records/edit', {
      record,
      employees,
      error: 'Please enter a valid date',
      formData: { employee_id, work_date, wage_amount }
    });
  }

  if (!isValidWage(wage_amount)) {
    const { record, employees } = await getFormData();
    return res.render('records/edit', {
      record,
      employees,
      error: 'Please enter a valid wage amount',
      formData: { employee_id, work_date, wage_amount }
    });
  }

  try {
    await pool.query(
      'UPDATE work_records SET employee_id = $1, work_date = $2, wage_amount = $3 WHERE id = $4',
      [employee_id, work_date, parseFloat(wage_amount) || 0, id]
    );
    res.redirect('/records?success=' + encodeURIComponent('Record updated successfully'));
  } catch (error) {
    console.error('Error updating record:', error);
    const { record, employees } = await getFormData();
    res.render('records/edit', {
      record,
      employees,
      error: 'Unable to update record. Please try again.',
      formData: { employee_id, work_date, wage_amount }
    });
  }
});

// Delete record
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
      'DELETE FROM work_records WHERE id = $1 RETURNING employee_id, work_date',
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
