const cron = require('node-cron');
const { sendDailyEmail } = require('./emailService');

function startScheduler() {
  // Run daily at 8:00 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('Running scheduled daily email task...');
    await sendDailyEmail();
  }, {
    timezone: process.env.TIMEZONE || 'America/New_York'
  });

  console.log('Scheduler started: Daily emails scheduled for 8:00 AM');
}

module.exports = { startScheduler };
