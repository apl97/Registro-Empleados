const sgMail = require('@sendgrid/mail');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');

// Only set API key if available (prevents startup errors)
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

async function sendDailyEmail() {
  const today = new Date().toISOString().split('T')[0];

  // Validate configuration before proceeding
  if (!process.env.SENDGRID_API_KEY) {
    console.error('SendGrid API key not configured');
    return { success: false, message: 'Email service not configured. Please set SENDGRID_API_KEY.' };
  }

  if (!process.env.SENDGRID_FROM_EMAIL) {
    console.error('SendGrid from email not configured');
    return { success: false, message: 'Email service not configured. Please set SENDGRID_FROM_EMAIL.' };
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get active employees
    const employeesResult = await client.query(
      'SELECT id, first_name, last_name FROM employees WHERE active = true ORDER BY first_name'
    );

    if (employeesResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('No active employees to include in email');
      return { success: false, message: 'No active employees. Add employees before sending.' };
    }

    // Get active recipients
    const recipientsResult = await client.query(
      'SELECT email FROM email_recipients WHERE active = true'
    );

    if (recipientsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('No active email recipients');
      return { success: false, message: 'No active recipients. Add email recipients first.' };
    }

    // Generate token for today
    const token = uuidv4();

    // Save daily email record BEFORE sending (will rollback if send fails)
    await client.query(
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
      return `
        <tr>
          <td style="padding: 4px 0;">
            <a href="${link}" style="
              display: block;
              padding: 12px 16px;
              background-color: #007aff;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              font-size: 15px;
              font-weight: 500;
              text-align: center;
            ">
              ${emp.first_name} ${emp.last_name}
            </a>
          </td>
        </tr>`;
    }).join('\n');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Work Attendance - ${formattedDate}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f9fafb;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f9fafb; padding: 32px 16px;">
          <tr>
            <td align="center">
              <!-- Main Container -->
              <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb; overflow: hidden; max-width: 100%;">

                <!-- Header -->
                <tr>
                  <td style="padding: 24px 24px 20px; border-bottom: 1px solid #e5e7eb;">
                    <h1 style="margin: 0; color: #111827; font-size: 20px; font-weight: 600; letter-spacing: -0.02em;">
                      Employee Tracker
                    </h1>
                  </td>
                </tr>

                <!-- Content Section -->
                <tr>
                  <td style="padding: 24px;">
                    <h2 style="margin: 0 0 8px 0; color: #111827; font-size: 16px; font-weight: 600; letter-spacing: -0.01em;">
                      Who worked today?
                    </h2>
                    <p style="margin: 0 0 20px 0; color: #6b7280; font-size: 14px; font-weight: 400;">
                      ${formattedDate}
                    </p>

                    <div style="background-color: #f9fafb; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; border: 1px solid #e5e7eb;">
                      <p style="margin: 0; color: #6b7280; font-size: 14px; font-weight: 400; line-height: 1.5;">
                        Click on a name below to record attendance:
                      </p>
                    </div>

                    <!-- Employee Buttons -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      ${employeeLinks}
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 16px 24px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                    <p style="margin: 0; color: #9ca3af; font-size: 12px; line-height: 1.5; text-align: center;">
                      <strong style="color: #6b7280; font-weight: 500;">Note:</strong> Each link can only be used once. Attendance is recorded immediately after clicking.
                    </p>
                  </td>
                </tr>

              </table>

              <!-- Email Footer -->
              <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 100%; margin-top: 16px;">
                <tr>
                  <td style="text-align: center; padding: 12px;">
                    <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                      Automated email from Employee Tracker
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </body>
      </html>
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

    // Only commit after successful email send
    await client.query('COMMIT');

    console.log(`Daily email sent successfully to ${recipients.length} recipient(s)`);
    return { success: true, message: `Email sent to ${recipients.length} recipient(s)` };

  } catch (error) {
    // Rollback on any error (including email send failure)
    await client.query('ROLLBACK');

    console.error('Error sending daily email:', error);

    // Provide user-friendly error messages
    let userMessage = 'Failed to send email. ';
    if (error.code === 401) {
      userMessage += 'Invalid API key. Please check SENDGRID_API_KEY configuration.';
    } else if (error.code === 403) {
      userMessage += 'Permission denied. Please verify SendGrid account settings.';
    } else if (error.response && error.response.body && error.response.body.errors) {
      userMessage += error.response.body.errors.map(e => e.message).join(', ');
    } else {
      userMessage += error.message || 'Please try again later.';
    }

    return { success: false, message: userMessage };
  } finally {
    client.release();
  }
}

async function sendTestEmail() {
  return await sendDailyEmail();
}

module.exports = { sendDailyEmail, sendTestEmail };
