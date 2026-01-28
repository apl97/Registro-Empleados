const express = require('express');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// List all recipients
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM email_recipients ORDER BY active DESC, email ASC'
    );
    res.render('recipients/index', { recipients: result.rows, error: null, success: null });
  } catch (error) {
    console.error('Error fetching recipients:', error);
    res.status(500).send('Error fetching recipients');
  }
});

// Add recipient
router.post('/', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    const result = await pool.query('SELECT * FROM email_recipients ORDER BY active DESC, email ASC');
    return res.render('recipients/index', {
      recipients: result.rows,
      error: 'Please enter a valid email address',
      success: null
    });
  }

  try {
    await pool.query(
      'INSERT INTO email_recipients (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET active = true',
      [email.trim().toLowerCase()]
    );
    const result = await pool.query('SELECT * FROM email_recipients ORDER BY active DESC, email ASC');
    res.render('recipients/index', {
      recipients: result.rows,
      error: null,
      success: 'Email recipient added successfully'
    });
  } catch (error) {
    console.error('Error adding recipient:', error);
    const result = await pool.query('SELECT * FROM email_recipients ORDER BY active DESC, email ASC');
    res.render('recipients/index', {
      recipients: result.rows,
      error: 'Error adding recipient',
      success: null
    });
  }
});

// Toggle recipient active status
router.post('/:id/toggle', async (req, res) => {
  try {
    await pool.query(
      'UPDATE email_recipients SET active = NOT active WHERE id = $1',
      [req.params.id]
    );
    res.redirect('/recipients');
  } catch (error) {
    console.error('Error toggling recipient:', error);
    res.status(500).send('Error toggling recipient');
  }
});

// Delete recipient
router.post('/:id/delete', async (req, res) => {
  try {
    await pool.query('DELETE FROM email_recipients WHERE id = $1', [req.params.id]);
    res.redirect('/recipients');
  } catch (error) {
    console.error('Error deleting recipient:', error);
    res.status(500).send('Error deleting recipient');
  }
});

module.exports = router;
