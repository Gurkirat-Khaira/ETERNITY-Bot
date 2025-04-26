const mongoose = require('mongoose');

const guildConfigSchema = new mongoose.Schema({
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
  }
});

module.exports = mongoose.model('GuildConfig', guildConfigSchema); 