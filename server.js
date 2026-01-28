require('dotenv').config();

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path = require('path');
const crypto = require('crypto');

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

// SECURITY: Validate session secret in production - refuse to start with weak/missing secret
if (isProduction) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-this-secret') {
    console.error('FATAL: SESSION_SECRET must be set to a strong random value in production!');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
  }
  if (process.env.SESSION_SECRET.length < 32) {
    console.error('FATAL: SESSION_SECRET must be at least 32 characters long');
    process.exit(1);
  }
} else if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-this-secret') {
  console.warn('WARNING: Using default session secret. Set SESSION_SECRET environment variable for production!');
}

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Trust Railway's proxy

// SECURITY: Add security headers
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // XSS protection (legacy but still useful)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Content Security Policy
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none';");
  // HSTS in production
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// SECURITY: Enforce HTTPS in production
if (isProduction) {
  app.use((req, res, next) => {
    // Railway and other proxies set x-forwarded-proto
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health check endpoint (before session middleware)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SECURITY: Generate CSRF tokens
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

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
  name: 'sid', // Use a generic name instead of default 'connect.sid'
  cookie: {
    secure: isProduction, // Use secure cookies in production
    httpOnly: true,
    sameSite: 'strict', // SECURITY: Prevent CSRF via cookies
    maxAge: 24 * 60 * 60 * 1000 // SECURITY: Reduced to 1 day from 7 days
  }
}));

// SECURITY: CSRF protection middleware for authenticated routes
app.use((req, res, next) => {
  // Initialize CSRF token if session exists
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  // Make token available to views
  res.locals.csrfToken = req.session ? req.session.csrfToken : '';
  next();
});

// SECURITY: CSRF validation for POST requests on protected routes
function validateCsrf(req, res, next) {
  // Skip CSRF for public tracking endpoint
  if (req.path.startsWith('/track/')) {
    return next();
  }

  const token = req.body._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    console.warn('CSRF validation failed for:', req.path, 'IP:', req.ip);
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'Invalid or missing security token. Please try again.',
      backLink: req.headers.referer || '/dashboard',
      backText: 'Go Back'
    });
  }
  next();
}

// Apply CSRF validation to all POST requests (except public routes)
app.use((req, res, next) => {
  if (req.method === 'POST' && !req.path.startsWith('/track/')) {
    return validateCsrf(req, res, next);
  }
  next();
});

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
    res.status(500).render('error', {
      title: 'Error',
      message: 'Unable to load dashboard. Please try again.',
      backLink: '/login',
      backText: 'Return to Login'
    });
  }
});

// Send test email
app.post('/send-test-email', requireAuth, async (req, res) => {
  let emailResult;

  try {
    emailResult = await sendTestEmail();
  } catch (error) {
    console.error('Send test email error:', error);
    emailResult = { success: false, message: 'An unexpected error occurred. Please try again.' };
  }

  // Always try to render the dashboard with results
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
      emailResult
    });
  } catch (dashboardError) {
    console.error('Error loading dashboard after email send:', dashboardError);
    // Fallback: redirect with a simple message
    res.redirect('/dashboard');
  }
});

// Home redirect
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// 404 handler - must be after all routes
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.',
    backLink: '/dashboard',
    backText: 'Go to Dashboard'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('error', {
    title: 'Server Error',
    message: 'Something went wrong. Please try again later.',
    backLink: '/dashboard',
    backText: 'Go to Dashboard'
  });
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
