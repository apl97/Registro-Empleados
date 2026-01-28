const express = require('express');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Email validation - more robust than just checking for @
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  // RFC 5322 compliant regex (simplified but covers most cases)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim()) && email.trim().length <= 254;
}

// Validate ID is a positive integer
function isValidId(id) {
  const num = parseInt(id, 10);
  return !isNaN(num) && num > 0;
}

// Helper to fetch recipients list
async function getRecipientsList() {
  const result = await pool.query(
    'SELECT * FROM email_recipients ORDER BY active DESC, email ASC'
  );
  return result.rows;
}

// List all recipients
router.get('/', async (req, res) => {
  try {
    const recipients = await getRecipientsList();
    // Get success message from query params
    const success = req.query.success || null;
    res.render('recipients/index', { recipients, error: null, success });
  } catch (error) {
    console.error('Error fetching recipients:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load email recipients. Please try again.',
      backLink: '/dashboard',
      backText: 'Return to Dashboard'
    });
  }
});

// Add recipient
router.post('/', async (req, res) => {
  const { email } = req.body;

  if (!isValidEmail(email)) {
    try {
      const recipients = await getRecipientsList();
      return res.render('recipients/index', {
        recipients,
        error: 'Please enter a valid email address (e.g., name@example.com)',
        success: null
      });
    } catch (fetchError) {
      console.error('Error fetching recipients:', fetchError);
      return res.status(500).render('error', {
        title: 'Error',
        message: 'Unable to process request. Please try again.',
        backLink: '/dashboard',
        backText: 'Return to Dashboard'
      });
    }
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Check if email already exists and is active
    const existing = await pool.query(
      'SELECT id, active FROM email_recipients WHERE email = $1',
      [normalizedEmail]
    );

    let successMessage;
    if (existing.rows.length > 0) {
      if (existing.rows[0].active) {
        successMessage = 'This email address is already receiving daily emails';
      } else {
        await pool.query(
          'UPDATE email_recipients SET active = true WHERE id = $1',
          [existing.rows[0].id]
        );
        successMessage = 'Email recipient reactivated successfully';
      }
    } else {
      await pool.query(
        'INSERT INTO email_recipients (email) VALUES ($1)',
        [normalizedEmail]
      );
      successMessage = 'Email recipient added successfully';
    }

    res.redirect('/recipients?success=' + encodeURIComponent(successMessage));
  } catch (error) {
    console.error('Error adding recipient:', error);
    try {
      const recipients = await getRecipientsList();
      res.render('recipients/index', {
        recipients,
        error: 'Unable to add recipient. Please try again.',
        success: null
      });
    } catch (fetchError) {
      res.status(500).render('error', {
        title: 'Error',
        message: 'Unable to add recipient. Please try again.',
        backLink: '/dashboard',
        backText: 'Return to Dashboard'
      });
    }
  }
});

// Toggle recipient active status
router.post('/:id/toggle', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'Invalid recipient ID.',
      backLink: '/recipients',
      backText: 'Back to Recipients'
    });
  }

  try {
    const result = await pool.query(
      'UPDATE email_recipients SET active = NOT active WHERE id = $1 RETURNING email, active',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Recipient not found.',
        backLink: '/recipients',
        backText: 'Back to Recipients'
      });
    }

    const { email, active } = result.rows[0];
    const action = active ? 'activated' : 'deactivated';
    res.redirect('/recipients?success=' + encodeURIComponent(`${email} has been ${action}`));
  } catch (error) {
    console.error('Error toggling recipient:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to update recipient. Please try again.',
      backLink: '/recipients',
      backText: 'Back to Recipients'
    });
  }
});

// Delete recipient
router.post('/:id/delete', async (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).render('error', {
      title: 'Invalid Request',
      message: 'Invalid recipient ID.',
      backLink: '/recipients',
      backText: 'Back to Recipients'
    });
  }

  try {
    const result = await pool.query(
      'DELETE FROM email_recipients WHERE id = $1 RETURNING email',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Recipient not found. They may have already been deleted.',
        backLink: '/recipients',
        backText: 'Back to Recipients'
      });
    }

    res.redirect('/recipients?success=' + encodeURIComponent(`${result.rows[0].email} has been removed`));
  } catch (error) {
    console.error('Error deleting recipient:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to delete recipient. Please try again.',
      backLink: '/recipients',
      backText: 'Back to Recipients'
    });
  }
});

module.exports = router;
