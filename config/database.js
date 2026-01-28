const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Enable SSL for Railway and other cloud databases
const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;
const connectionString = process.env.DATABASE_URL;

// SECURITY: SSL configuration
// In production, we should verify certificates. Set DATABASE_SSL_REJECT_UNAUTHORIZED=false
// only if your database provider doesn't support proper SSL certificates.
const sslConfig = connectionString && !connectionString.includes('localhost')
  ? {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false'
    }
  : false;

const pool = new Pool({
  connectionString,
  ssl: sslConfig
});

async function initializeDatabase() {
  const client = await pool.connect();

  try {
    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        daily_wage DECIMAL(12, 2) DEFAULT 0,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add daily_wage column if it doesn't exist (migration for existing databases)
    await client.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS daily_wage DECIMAL(12, 2) DEFAULT 0
    `).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS work_records (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id),
        work_date DATE NOT NULL,
        wage_amount DECIMAL(12, 2) DEFAULT 0,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        email_token VARCHAR(255)
      )
    `);

    // Add wage_amount column if it doesn't exist (migration for existing databases)
    await client.query(`
      ALTER TABLE work_records ADD COLUMN IF NOT EXISTS wage_amount DECIMAL(12, 2) DEFAULT 0
    `).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_recipients (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_emails (
        id SERIAL PRIMARY KEY,
        sent_date DATE NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        used BOOLEAN DEFAULT false,
        used_by_employee_id INTEGER REFERENCES employees(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better query performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_work_records_employee_id ON work_records(employee_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_work_records_work_date ON work_records(work_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_emails_sent_date ON daily_emails(sent_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(active)
    `);

    // Drop the unique constraint if it exists (we now allow manual record management)
    await client.query(`
      DROP INDEX IF EXISTS idx_work_records_unique_daily
    `).catch(() => {});

    // SECURITY: Create admin user only if credentials are properly configured
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    // Validate admin credentials before creating user
    if (adminUsername && adminPassword) {
      // SECURITY: Enforce minimum password requirements
      const MIN_PASSWORD_LENGTH = 12;
      const passwordErrors = [];

      if (adminPassword.length < MIN_PASSWORD_LENGTH) {
        passwordErrors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      if (adminPassword === 'changeme' || adminPassword === 'password' || adminPassword === 'admin') {
        passwordErrors.push('Password cannot be a common default value');
      }
      if (adminPassword.toLowerCase() === adminUsername.toLowerCase()) {
        passwordErrors.push('Password cannot be the same as username');
      }

      if (passwordErrors.length > 0 && isProduction) {
        console.error('FATAL: Admin password does not meet security requirements:');
        passwordErrors.forEach(err => console.error(`  - ${err}`));
        throw new Error('Insecure admin password configuration');
      } else if (passwordErrors.length > 0) {
        console.warn('WARNING: Admin password is weak. This is only allowed in development mode.');
        passwordErrors.forEach(err => console.warn(`  - ${err}`));
      }

      const existingAdmin = await client.query(
        'SELECT id FROM users WHERE username = $1',
        [adminUsername]
      );

      if (existingAdmin.rows.length === 0) {
        // SECURITY: Use higher bcrypt cost factor (12 instead of 10)
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await client.query(
          'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
          [adminUsername, passwordHash]
        );
        // SECURITY: Don't log username to avoid credential exposure in logs
        console.log('Admin user created successfully');
      }
    } else if (isProduction) {
      // SECURITY: In production, require explicit admin credentials
      console.warn('WARNING: No admin credentials configured. Set ADMIN_USERNAME and ADMIN_PASSWORD environment variables.');
    } else {
      console.log('Note: No admin credentials configured. Set ADMIN_USERNAME and ADMIN_PASSWORD to create an admin user.');
    }

    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

module.exports = { pool, initializeDatabase };
