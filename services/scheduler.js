const cron = require('node-cron');
const { sendDailyEmail } = require('./emailService');

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes between retries

async function sendWithRetry(attempt = 1) {
  console.log(`Running scheduled daily email task (attempt ${attempt}/${MAX_RETRIES})...`);

  try {
    const result = await sendDailyEmail();

    if (result.success) {
      console.log('Scheduled email sent successfully:', result.message);
      return;
    }

    // If it failed but not due to a retriable error, don't retry
    if (result.message.includes('already sent') ||
        result.message.includes('No active employees') ||
        result.message.includes('No active recipients') ||
        result.message.includes('not configured')) {
      console.log('Scheduled email not sent (non-retriable):', result.message);
      return;
    }

    // Retriable failure
    if (attempt < MAX_RETRIES) {
      console.log(`Scheduled email failed, will retry in ${RETRY_DELAY_MS / 60000} minutes:`, result.message);
      setTimeout(() => sendWithRetry(attempt + 1), RETRY_DELAY_MS);
    } else {
      console.error('Scheduled email failed after all retries:', result.message);
    }
  } catch (error) {
    console.error('Unexpected error in scheduled email task:', error);

    if (attempt < MAX_RETRIES) {
      console.log(`Will retry in ${RETRY_DELAY_MS / 60000} minutes...`);
      setTimeout(() => sendWithRetry(attempt + 1), RETRY_DELAY_MS);
    } else {
      console.error('Scheduled email task failed after all retries');
    }
  }
}

function startScheduler() {
  const timezone = process.env.TIMEZONE || 'America/New_York';
  const scheduleTime = process.env.EMAIL_SCHEDULE_TIME || '0 8 * * *';

  // Validate cron expression
  if (!cron.validate(scheduleTime)) {
    console.error(`Invalid cron expression: ${scheduleTime}. Using default: 0 8 * * *`);
  }

  // Run daily at configured time (default 8:00 AM)
  cron.schedule(scheduleTime, () => {
    sendWithRetry(1);
  }, {
    timezone
  });

  console.log(`Scheduler started: Daily emails scheduled for ${scheduleTime} (${timezone})`);
}

module.exports = { startScheduler };
