require('dotenv').config();

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path = require('path');

const { pool, initializeDatabase } = require('./config/database');
const { requireAuth } = require('./middleware/auth');
const { startScheduler } = require('./services/scheduler');
const { sendTestEmail } = require('./services/emailService');

const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const recordRoutes = require('./routes/records');
const trackingRoutes = require('./routes/tracking');
const recipientRoutes = require('./routes/recipients');

const app = express();
const PORT = process.env.PORT || 3000;

// Detect production environment (Railway sets RAILWAY_ENVIRONMENT)
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

console.log('Starting server...');
console.log('Environment:', isProduction ? 'production' : 'development');
console.log('Port:', PORT);
console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Trust Railway's proxy
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check endpoint (before session middleware)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Session configuration
app.use(session({
  store: new PgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction, // Use secure cookies in production
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Routes
app.use('/', authRoutes);
app.use('/employees', employeeRoutes);
app.use('/records', recordRoutes);
app.use('/track', trackingRoutes);
app.use('/recipients', recipientRoutes);

// Dashboard
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    const [activeEmployees, recordsThisMonth, activeRecipients, recentRecords] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM employees WHERE active = true'),
      pool.query('SELECT COUNT(*) as count FROM work_records WHERE work_date >= $1', [firstDayOfMonth]),
      pool.query('SELECT COUNT(*) as count FROM email_recipients WHERE active = true'),
      pool.query(`
        SELECT wr.work_date, e.first_name, e.last_name
        FROM work_records wr
        JOIN employees e ON wr.employee_id = e.id
        ORDER BY wr.work_date DESC, wr.recorded_at DESC
        LIMIT 5
      `)
    ]);

    res.render('dashboard', {
      stats: {
        activeEmployees: activeEmployees.rows[0].count,
        recordsThisMonth: recordsThisMonth.rows[0].count,
        activeRecipients: activeRecipients.rows[0].count
      },
      recentRecords: recentRecords.rows,
      emailResult: null
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Error loading dashboard');
  }
});

// Send test email
app.post('/send-test-email', requireAuth, async (req, res) => {
  try {
    const result = await sendTestEmail();

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

    const [activeEmployees, recordsThisMonth, activeRecipients, recentRecords] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM employees WHERE active = true'),
      pool.query('SELECT COUNT(*) as count FROM work_records WHERE work_date >= $1', [firstDayOfMonth]),
      pool.query('SELECT COUNT(*) as count FROM email_recipients WHERE active = true'),
      pool.query(`
        SELECT wr.work_date, e.first_name, e.last_name
        FROM work_records wr
        JOIN employees e ON wr.employee_id = e.id
        ORDER BY wr.work_date DESC, wr.recorded_at DESC
        LIMIT 5
      `)
    ]);

    res.render('dashboard', {
      stats: {
        activeEmployees: activeEmployees.rows[0].count,
        recordsThisMonth: recordsThisMonth.rows[0].count,
        activeRecipients: activeRecipients.rows[0].count
      },
      recentRecords: recentRecords.rows,
      emailResult: result
    });
  } catch (error) {
    console.error('Send test email error:', error);
    res.redirect('/dashboard');
  }
});

// Home redirect
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// Initialize and start
async function start() {
  // Start server first so Railway can see it's responding
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });

  // Then initialize database
  try {
    await initializeDatabase();
    console.log('Database initialized');
    startScheduler();
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    console.error('Full error:', error);
    // Don't exit - keep server running so we can see logs
  }
}

start();
