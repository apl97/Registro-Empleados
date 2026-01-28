const express = require('express');
const { pool } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { employee_id, start_date, end_date } = req.query;

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

    query += ' ORDER BY wr.work_date DESC, wr.recorded_at DESC';

    const recordsResult = await pool.query(query, params);
    const employeesResult = await pool.query(
      'SELECT id, first_name, last_name FROM employees ORDER BY first_name'
    );

    res.render('records/index', {
      records: recordsResult.rows,
      employees: employeesResult.rows,
      filters: { employee_id, start_date, end_date }
    });
  } catch (error) {
    console.error('Error fetching records:', error);
    res.status(500).send('Error fetching records');
  }
});

// Delete a work record
router.post('/:id/delete', async (req, res) => {
  try {
    await pool.query('DELETE FROM work_records WHERE id = $1', [req.params.id]);
    res.redirect('/records');
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).send('Error deleting record');
  }
});

module.exports = router;
