const express = require('express');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Validation constants
const MAX_NAME_LENGTH = 100;
const NAME_PATTERN = /^[a-zA-ZÀ-ÿ\s'-]+$/; // Allow letters, spaces, hyphens, apostrophes

// Validate employee ID is a positive integer
function isValidId(id) {
  const num = parseInt(id, 10);
  return !isNaN(num) && num > 0;
}

// Validate name field
function validateName(name, fieldName) {
  if (!name || name.trim().length === 0) {
    return `${fieldName} is required`;
  }
  if (name.trim().length > MAX_NAME_LENGTH) {
    return `${fieldName} must be ${MAX_NAME_LENGTH} characters or less`;
  }
  if (!NAME_PATTERN.test(name.trim())) {
    return `${fieldName} contains invalid characters`;
  }
  return null;
}

// List all employees
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM employees ORDER BY active DESC, first_name ASC'
    );
    // Get success message from query params (set via redirect)
    const success = req.query.success || null;
    res.render('employees/index', { employees: result.rows, success });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load employees. Please try again.',
      backLink: '/dashboard',
      backText: 'Return to Dashboard'
    });
  }
});

// New employee form
router.get('/new', (req, res) => {
  res.render('employees/new', { error: null, formData: {} });
});

// Create employee
router.post('/', async (req, res) => {
  const { first_name, last_name } = req.body;

  // Validate inputs
  const firstNameError = validateName(first_name, 'First name');
  if (firstNameError) {
    return res.render('employees/new', {
      error: firstNameError,
      formData: { first_name, last_name }
    });
  }

  const lastNameError = validateName(last_name, 'Last name');
  if (lastNameError) {
    return res.render('employees/new', {
      error: lastNameError,
      formData: { first_name, last_name }
    });
  }

  try {
    await pool.query(
      'INSERT INTO employees (first_name, last_name) VALUES ($1, $2)',
      [first_name.trim(), last_name.trim()]
    );
    res.redirect('/employees?success=' + encodeURIComponent('Employee added successfully'));
  } catch (error) {
    console.error('Error creating employee:', error);
    res.render('employees/new', {
      error: 'Unable to create employee. Please try again.',
      formData: { first_name, last_name }
    });
  }
});

// Edit employee form
router.get('/:id/edit', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'Invalid employee ID.',
      backLink: '/employees',
      backText: 'Back to Employees'
    });
  }

  try {
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Employee not found. They may have been deleted.',
        backLink: '/employees',
        backText: 'Back to Employees'
      });
    }

    res.render('employees/edit', { employee: result.rows[0], error: null, formData: null });
  } catch (error) {
    console.error('Error fetching employee:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load employee details. Please try again.',
      backLink: '/employees',
      backText: 'Back to Employees'
    });
  }
});

// Update employee
router.post('/:id', async (req, res) => {
  const { first_name, last_name, active } = req.body;
  const id = req.params.id;

  if (!isValidId(id)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'Invalid employee ID.',
      backLink: '/employees',
      backText: 'Back to Employees'
    });
  }

  // Fetch current employee data for error fallback
  let currentEmployee;
  try {
    const result = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Employee not found. They may have been deleted.',
        backLink: '/employees',
        backText: 'Back to Employees'
      });
    }
    currentEmployee = result.rows[0];
  } catch (error) {
    console.error('Error fetching employee:', error);
    return res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load employee. Please try again.',
      backLink: '/employees',
      backText: 'Back to Employees'
    });
  }

  // Validate inputs
  const firstNameError = validateName(first_name, 'First name');
  if (firstNameError) {
    return res.render('employees/edit', {
      employee: currentEmployee,
      error: firstNameError,
      formData: { first_name, last_name, active: active === 'on' }
    });
  }

  const lastNameError = validateName(last_name, 'Last name');
  if (lastNameError) {
    return res.render('employees/edit', {
      employee: currentEmployee,
      error: lastNameError,
      formData: { first_name, last_name, active: active === 'on' }
    });
  }

  try {
    await pool.query(
      'UPDATE employees SET first_name = $1, last_name = $2, active = $3 WHERE id = $4',
      [first_name.trim(), last_name.trim(), active === 'on', id]
    );
    res.redirect('/employees?success=' + encodeURIComponent('Employee updated successfully'));
  } catch (error) {
    console.error('Error updating employee:', error);
    res.render('employees/edit', {
      employee: currentEmployee,
      error: 'Unable to update employee. Please try again.',
      formData: { first_name, last_name, active: active === 'on' }
    });
  }
});

// Deactivate employee
router.post('/:id/deactivate', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'Invalid employee ID.',
      backLink: '/employees',
      backText: 'Back to Employees'
    });
  }

  try {
    const result = await pool.query(
      'UPDATE employees SET active = false WHERE id = $1 RETURNING first_name, last_name',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Employee not found.',
        backLink: '/employees',
        backText: 'Back to Employees'
      });
    }

    const emp = result.rows[0];
    res.redirect('/employees?success=' + encodeURIComponent(`${emp.first_name} ${emp.last_name} has been deactivated`));
  } catch (error) {
    console.error('Error deactivating employee:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to deactivate employee. Please try again.',
      backLink: '/employees',
      backText: 'Back to Employees'
    });
  }
});

module.exports = router;
