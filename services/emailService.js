const sgMail = require('@sendgrid/mail');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendDailyEmail() {
  const today = new Date().toISOString().split('T')[0];

  try {
    // Check if email already sent today
    const existingEmail = await pool.query(
      'SELECT id FROM daily_emails WHERE sent_date = $1',
      [today]
    );

    if (existingEmail.rows.length > 0) {
      console.log('Daily email already sent for today');
      return { success: false, message: 'Email already sent today' };
    }

    // Get active employees
    const employeesResult = await pool.query(
      'SELECT id, first_name, last_name FROM employees WHERE active = true ORDER BY first_name'
    );

    if (employeesResult.rows.length === 0) {
      console.log('No active employees to include in email');
      return { success: false, message: 'No active employees' };
    }

    // Get active recipients
    const recipientsResult = await pool.query(
      'SELECT email FROM email_recipients WHERE active = true'
    );

    if (recipientsResult.rows.length === 0) {
      console.log('No active email recipients');
      return { success: false, message: 'No active recipients' };
    }

    // Generate token for today
    const token = uuidv4();

    // Save daily email record
    await pool.query(
      'INSERT INTO daily_emails (sent_date, token) VALUES ($1, $2)',
      [today, token]
    );

    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    // Build email content
    const employees = employeesResult.rows;
    const formattedDate = new Date(today).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const employeeLinks = employees.map(emp => {
      const link = `${appUrl}/track/${token}/${emp.id}`;
      return `<li style="margin-bottom: 15px;">
        <a href="${link}" style="font-size: 18px; color: #0066cc; text-decoration: none;">
          ${emp.first_name} ${emp.last_name}
        </a>
      </li>`;
    }).join('\n');

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">Who worked today?</h2>
        <p style="color: #666; font-size: 16px;">${formattedDate}</p>
        <p style="color: #333; font-size: 16px;">Click the name of the person who worked:</p>
        <ul style="list-style: none; padding: 0;">
          ${employeeLinks}
        </ul>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          This link can only be used once. After clicking, the attendance will be recorded.
        </p>
      </div>
    `;

    const textContent = `Who worked today?\n\n${formattedDate}\n\nClick the link for the person who worked:\n\n` +
      employees.map(emp => `${emp.first_name} ${emp.last_name}: ${appUrl}/track/${token}/${emp.id}`).join('\n\n') +
      '\n\nNote: This link can only be used once.';

    // Send email to all recipients
    const recipients = recipientsResult.rows.map(r => r.email);

    const msg = {
      to: recipients,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      subject: `Work Attendance - ${formattedDate}`,
      text: textContent,
      html: htmlContent
    };

    await sgMail.send(msg);

    console.log(`Daily email sent successfully to ${recipients.length} recipient(s)`);
    return { success: true, message: `Email sent to ${recipients.length} recipient(s)` };

  } catch (error) {
    console.error('Error sending daily email:', error);
    return { success: false, message: error.message };
  }
}

async function sendTestEmail() {
  return await sendDailyEmail();
}

module.exports = { sendDailyEmail, sendTestEmail };
