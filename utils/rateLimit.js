/**
 * Enhanced rate limiting utility for commands
 */

// Store command cooldowns per user with separate maps for guilds
const userCooldowns = new Map();
const guildCooldowns = new Map();

// Memory cache for recently used commands in case of bot restart
let cooldownCache = {
  lastPersisted: Date.now(),
  users: {},
  guilds: {}
};

// Maximum requests per minute per guild (for guild-wide rate limits)
const MAX_GUILD_REQUESTS_PER_MINUTE = 30;

/**
 * Check if a user can run a command based on cooldown
 * @param {string} userId - Discord user ID
 * @param {string} commandName - Command name
 * @param {number} cooldownSeconds - Cooldown in seconds
 * @param {string} guildId - Optional guild ID for guild-specific rate limits
 * @returns {object} Object with isLimited, remainingTime, and reason properties
 */
function checkCommandLimit(userId, commandName, cooldownSeconds = 3, guildId = null) {
  try {
    // Get current timestamp
    const now = Date.now();
    
    // Check for invalid inputs
    if (!userId || !commandName) {
      return { 
        isLimited: true, 
        remainingTime: cooldownSeconds,
        reason: 'Invalid user or command information'
      };
    }
    
    // Create unique key for user + command combination
    const cooldownKey = `${userId}-${commandName}`;
    
    // First check user-specific cooldown
    // If cooldowns doesn't have this command yet, create a new Map
    if (!userCooldowns.has(commandName)) {
      userCooldowns.set(commandName, new Map());
    }
    
    // Get the cooldowns for the command
    const timestamps = userCooldowns.get(commandName);
    
    // Get the last time this user used this command
    const lastUsage = timestamps.get(userId);
    
    // Calculate cooldown time in milliseconds
    const cooldownMs = cooldownSeconds * 1000;
    
    // Check if user is on cooldown
    if (lastUsage && (now < lastUsage + cooldownMs)) {
      // Calculate remaining time
      const remainingTime = Math.ceil((lastUsage + cooldownMs - now) / 1000);
      return { 
        isLimited: true, 
        remainingTime: remainingTime,
        reason: 'User cooldown'
      };
    }
    
    // Check guild-wide rate limit if a guild ID was provided
    if (guildId) {
      // Check if this guild has hit the rate limit
      if (!guildCooldowns.has(guildId)) {
        guildCooldowns.set(guildId, {
          count: 0,
          resetTime: now + 60000 // 1 minute from now
        });
      }
      
      const guildLimit = guildCooldowns.get(guildId);
      
      // Reset counter if the minute has passed
      if (now > guildLimit.resetTime) {
        guildLimit.count = 0;
        guildLimit.resetTime = now + 60000;
      }
      
      // Check if guild has hit rate limit
      if (guildLimit.count >= MAX_GUILD_REQUESTS_PER_MINUTE) {
        const guildRemainingTime = Math.ceil((guildLimit.resetTime - now) / 1000);
        return {
          isLimited: true,
          remainingTime: guildRemainingTime,
          reason: 'Guild rate limit exceeded'
        };
      }
      
      // Increment guild command count
      guildLimit.count++;
    }
    
    // Set the timestamp for when the user used the command
    timestamps.set(userId, now);
    
    // Update cache for persistence
    updateCooldownCache(commandName, userId, now, guildId);
    
    // Remove the user from cooldown after the cooldown period has expired
    setTimeout(() => {
      timestamps.delete(userId);
      
      // Also remove from cache
      if (cooldownCache.users[commandName] && cooldownCache.users[commandName][userId]) {
        delete cooldownCache.users[commandName][userId];
      }
    }, cooldownMs);
    
    return { isLimited: false, remainingTime: 0, reason: null };
  } catch (error) {
    console.error('Error in rate limit check:', error);
    // Fail safe - don't rate limit on errors
    return { isLimited: false, remainingTime: 0, reason: 'Error in rate limit check' };
  }
}

/**
 * Update cooldown cache for persistence
 * @param {string} commandName - Command name
 * @param {string} userId - User ID
 * @param {number} timestamp - Current timestamp
 * @param {string} guildId - Optional guild ID
 */
function updateCooldownCache(commandName, userId, timestamp, guildId) {
  // Initialize command in cache if needed
  if (!cooldownCache.users[commandName]) {
    cooldownCache.users[commandName] = {};
  }
  
  // Store user cooldown
  cooldownCache.users[commandName][userId] = timestamp;
  
  // Store guild data if applicable
  if (guildId) {
    if (!cooldownCache.guilds[guildId]) {
      cooldownCache.guilds[guildId] = {
        count: 0,
        resetTime: timestamp + 60000
      };
    }
    cooldownCache.guilds[guildId].count++;
  }
  
  // Every 5 minutes, clean up old entries
  if (timestamp - cooldownCache.lastPersisted > 300000) {
    cleanupCache(timestamp);
    cooldownCache.lastPersisted = timestamp;
  }
}

/**
 * Clean up expired entries from the cooldown cache
 * @param {number} now - Current timestamp
 */
function cleanupCache(now) {
  try {
    // Clean up user cooldowns
    for (const commandName in cooldownCache.users) {
      for (const userId in cooldownCache.users[commandName]) {
        const timestamp = cooldownCache.users[commandName][userId];
        // Remove entries older than 10 minutes
        if (now - timestamp > 600000) {
          delete cooldownCache.users[commandName][userId];
        }
      }
      
      // Remove empty command objects
      if (Object.keys(cooldownCache.users[commandName]).length === 0) {
        delete cooldownCache.users[commandName];
      }
    }
    
    // Clean up guild rate limits
    for (const guildId in cooldownCache.guilds) {
      if (now > cooldownCache.guilds[guildId].resetTime) {
        delete cooldownCache.guilds[guildId];
      }
    }
  } catch (error) {
    console.error('Error cleaning up rate limit cache:', error);
  }
}

/**
 * Get default cooldown for specific command types
 * @param {string} commandName - Command name
 * @returns {number} Cooldown in seconds
 */
function getDefaultCooldown(commandName) {
  try {
    // Validate input
    if (!commandName) return parseInt(process.env.DEFAULT_COOLDOWN) || 3;
    
    // Admin commands have no cooldown
    if (['reload', 'setprefix', 'setnoti'].includes(commandName)) {
      return parseInt(process.env.ADMIN_COOLDOWN) || 0;
    }
    
    // Stats commands have a short cooldown
    if (['stats', 'leaderboard'].includes(commandName)) {
      return parseInt(process.env.STATS_COOLDOWN) || 5;
    }
    
    // Default cooldown for other commands
    return parseInt(process.env.DEFAULT_COOLDOWN) || 3;
  } catch (error) {
    console.error('Error getting default cooldown:', error);
    return 3; // Fallback to 3 seconds on error
  }
}

/**
 * Reset rate limits for a specific user or guild
 * @param {string} id - User ID or Guild ID to reset
 * @param {boolean} isGuild - Whether the ID is for a guild
 */
function resetRateLimits(id, isGuild = false) {
  try {
    if (isGuild) {
      // Reset guild rate limits
      if (guildCooldowns.has(id)) {
        guildCooldowns.delete(id);
      }
      if (cooldownCache.guilds[id]) {
        delete cooldownCache.guilds[id];
      }
    } else {
      // Reset user rate limits
      for (const [commandName, users] of userCooldowns.entries()) {
        if (users.has(id)) {
          users.delete(id);
        }
      }
      
      // Also clean from cache
      for (const commandName in cooldownCache.users) {
        if (cooldownCache.users[commandName][id]) {
          delete cooldownCache.users[commandName][id];
        }
      }
    }
  } catch (error) {
    console.error('Error resetting rate limits:', error);
  }
}

module.exports = {
  checkCommandLimit,
  getDefaultCooldown,
  resetRateLimits
}; 