const express = require('express');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// List all employees
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM employees ORDER BY active DESC, first_name ASC'
    );
    res.render('employees/index', { employees: result.rows });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).send('Error fetching employees');
  }
});

// New employee form
router.get('/new', (req, res) => {
  res.render('employees/new', { error: null });
});

// Create employee
router.post('/', async (req, res) => {
  const { first_name, last_name } = req.body;

  if (!first_name || !last_name) {
    return res.render('employees/new', { error: 'First name and last name are required' });
  }

  try {
    await pool.query(
      'INSERT INTO employees (first_name, last_name) VALUES ($1, $2)',
      [first_name.trim(), last_name.trim()]
    );
    res.redirect('/employees');
  } catch (error) {
    console.error('Error creating employee:', error);
    res.render('employees/new', { error: 'Error creating employee' });
  }
});

// Edit employee form
router.get('/:id/edit', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).send('Employee not found');
    }

    res.render('employees/edit', { employee: result.rows[0], error: null });
  } catch (error) {
    console.error('Error fetching employee:', error);
    res.status(500).send('Error fetching employee');
  }
});

// Update employee
router.post('/:id', async (req, res) => {
  const { first_name, last_name, active } = req.body;
  const id = req.params.id;

  if (!first_name || !last_name) {
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    return res.render('employees/edit', {
      employee: result.rows[0],
      error: 'First name and last name are required'
    });
  }

  try {
    await pool.query(
      'UPDATE employees SET first_name = $1, last_name = $2, active = $3 WHERE id = $4',
      [first_name.trim(), last_name.trim(), active === 'on', id]
    );
    res.redirect('/employees');
  } catch (error) {
    console.error('Error updating employee:', error);
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    res.render('employees/edit', {
      employee: result.rows[0],
      error: 'Error updating employee'
    });
  }
});

// Deactivate employee
router.post('/:id/deactivate', async (req, res) => {
  try {
    await pool.query('UPDATE employees SET active = false WHERE id = $1', [req.params.id]);
    res.redirect('/employees');
  } catch (error) {
    console.error('Error deactivating employee:', error);
    res.status(500).send('Error deactivating employee');
  }
});

module.exports = router;
