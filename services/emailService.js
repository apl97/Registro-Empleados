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
      return `
        <tr>
          <td style="padding: 12px 0;">
            <a href="${link}" style="
              display: block;
              padding: 16px 24px;
              background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
              color: white;
              text-decoration: none;
              border-radius: 8px;
              font-size: 16px;
              font-weight: 600;
              text-align: center;
              box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
              transition: all 0.2s;
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
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f8fafc; padding: 40px 20px;">
          <tr>
            <td align="center">
              <!-- Main Container -->
              <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="background-color: white; border-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); overflow: hidden; max-width: 100%;">

                <!-- Header with Gradient -->
                <tr>
                  <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 40px; text-align: center;">
                    <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 800; letter-spacing: -0.02em;">
                      Employee Tracker
                    </h1>
                  </td>
                </tr>

                <!-- Content Section -->
                <tr>
                  <td style="padding: 40px;">
                    <h2 style="margin: 0 0 8px 0; color: #0f172a; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">
                      Who worked today?
                    </h2>
                    <p style="margin: 0 0 24px 0; color: #64748b; font-size: 16px;">
                      ${formattedDate}
                    </p>

                    <div style="background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); border-radius: 12px; padding: 24px; margin-bottom: 24px; border-left: 4px solid #4f46e5;">
                      <p style="margin: 0; color: #334155; font-size: 15px; font-weight: 500;">
                        Click the name of the person who worked today to record their attendance:
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
                  <td style="padding: 24px 40px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="text-align: center;">
                          <p style="margin: 0; color: #94a3b8; font-size: 13px; line-height: 1.6;">
                            <strong style="color: #64748b;">Important:</strong> Each link can only be used once.<br>
                            After clicking, the attendance will be recorded immediately.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>

              <!-- Email Footer -->
              <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 100%; margin-top: 24px;">
                <tr>
                  <td style="text-align: center; padding: 20px;">
                    <p style="margin: 0; color: #94a3b8; font-size: 12px;">
                      This is an automated email from Employee Tracker
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
