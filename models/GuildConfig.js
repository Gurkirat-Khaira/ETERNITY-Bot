const { Schema, model } = require('mongoose');

const GuildConfigSchema = new Schema({
  guildId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  guildName: {
    type: String,
    required: true
  },
  prefix: {
    type: String,
    default: process.env.DEFAULT_PREFIX || '!'
  },
  notificationChannelId: {
    type: String,
    default: null
  },
  trackStreamActivity: {
    type: Boolean,
    default: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  // Report settings
  hourlyReportEnabled: { type: Boolean, default: false },
  dailyReportEnabled: { type: Boolean, default: false },
  timezone: { type: String, default: 'UTC' } // Timezone for reports
});

module.exports = model('GuildConfig', GuildConfigSchema); 