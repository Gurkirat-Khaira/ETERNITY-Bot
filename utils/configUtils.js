const GuildConfig = require('../models/GuildConfig');

/**
 * Get or create a guild configuration
 * @param {String} guildId - Discord guild/server ID
 * @param {String} guildName - Discord guild/server name
 * @returns {Promise<Object>} - Guild configuration document
 */
const getOrCreateGuildConfig = async (guildId, guildName) => {
  try {
    let guildConfig = await GuildConfig.findOne({ guildId });
    
    if (!guildConfig) {
      guildConfig = new GuildConfig({
        guildId,
        guildName
      });
      await guildConfig.save();
    }
    
    return guildConfig;
  } catch (error) {
    console.error('Error in getOrCreateGuildConfig:', error);
    throw error;
  }
};

/**
 * Set guild notification channel
 * @param {String} guildId - Discord guild/server ID
 * @param {String} channelId - Discord channel ID for notifications
 * @returns {Promise<Boolean>} - Success status
 */
const setNotificationChannel = async (guildId, channelId) => {
  try {
    const guildConfig = await getOrCreateGuildConfig(guildId);
    
    guildConfig.notificationChannelId = channelId;
    guildConfig.lastUpdated = new Date();
    await guildConfig.save();
    
    return true;
  } catch (error) {
    console.error('Error in setNotificationChannel:', error);
    return false;
  }
};

/**
 * Set guild prefix
 * @param {String} guildId - Discord guild/server ID
 * @param {String} prefix - Custom command prefix
 * @returns {Promise<Boolean>} - Success status
 */
const setGuildPrefix = async (guildId, prefix) => {
  try {
    const guildConfig = await getOrCreateGuildConfig(guildId);
    
    guildConfig.prefix = prefix;
    guildConfig.lastUpdated = new Date();
    await guildConfig.save();
    
    return true;
  } catch (error) {
    console.error('Error in setGuildPrefix:', error);
    return false;
  }
};

/**
 * Get guild prefix
 * @param {String} guildId - Discord guild/server ID
 * @returns {Promise<String>} - Guild prefix or default prefix
 */
const getGuildPrefix = async (guildId) => {
  try {
    const guildConfig = await GuildConfig.findOne({ guildId });
    
    if (guildConfig && guildConfig.prefix) {
      return guildConfig.prefix;
    }
    
    return process.env.DEFAULT_PREFIX || '!';
  } catch (error) {
    console.error('Error in getGuildPrefix:', error);
    return process.env.DEFAULT_PREFIX || '!';
  }
};

/**
 * Toggle stream activity tracking
 * @param {String} guildId - Discord guild/server ID
 * @param {Boolean} trackStreamActivity - Whether to track stream activity
 * @returns {Promise<Boolean>} - Success status
 */
const toggleStreamTracking = async (guildId, trackStreamActivity) => {
  try {
    const guildConfig = await getOrCreateGuildConfig(guildId);
    
    guildConfig.trackStreamActivity = trackStreamActivity;
    guildConfig.lastUpdated = new Date();
    await guildConfig.save();
    
    return true;
  } catch (error) {
    console.error('Error in toggleStreamTracking:', error);
    return false;
  }
};

/**
 * Check if stream tracking is enabled for a guild
 * @param {String} guildId - Discord guild/server ID
 * @returns {Promise<Boolean>} - Whether stream tracking is enabled
 */
const isStreamTrackingEnabled = async (guildId) => {
  try {
    const guildConfig = await GuildConfig.findOne({ guildId });
    
    if (guildConfig) {
      return guildConfig.trackStreamActivity;
    }
    
    return true; // Default to true if no config exists
  } catch (error) {
    console.error('Error in isStreamTrackingEnabled:', error);
    return true; // Default to true on error
  }
};

/**
 * Get notification channel for a guild
 * @param {String} guildId - Discord guild/server ID
 * @returns {Promise<String|null>} - Channel ID or null
 */
const getNotificationChannel = async (guildId) => {
  try {
    const guildConfig = await GuildConfig.findOne({ guildId });
    
    if (guildConfig) {
      return guildConfig.notificationChannelId;
    }
    
    return null;
  } catch (error) {
    console.error('Error in getNotificationChannel:', error);
    return null;
  }
};

module.exports = {
  getOrCreateGuildConfig,
  setNotificationChannel,
  setGuildPrefix,
  getGuildPrefix,
  toggleStreamTracking,
  isStreamTrackingEnabled,
  getNotificationChannel
}; 