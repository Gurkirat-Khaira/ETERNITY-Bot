const StreamActivity = require('../models/StreamActivity');
const mongoose = require('mongoose');

/**
 * Gets or creates a stream activity record for a user in a guild
 * 
 * @param {String} userId - Discord user ID
 * @param {String} username - Discord username
 * @param {String} guildId - Discord guild/server ID
 * @param {String} guildName - Discord guild/server name
 * @returns {Promise<Object>} - Stream activity document
 */
const getOrCreateStreamActivity = async (userId, username, guildId, guildName) => {
  try {
    // First try to find an existing record
    let streamActivity = await StreamActivity.findOne({ userId, guildId });
    
    // If no record exists, create a new one
    if (!streamActivity) {
      streamActivity = new StreamActivity({
        userId,
        username,
        guildId,
        guildName,
        streams: []
      });
      await streamActivity.save();
    }
    
    return streamActivity;
  } catch (error) {
    console.error('Error in getOrCreateStreamActivity:', error);
    throw error;
  }
};

/**
 * Starts tracking a user's stream session
 * 
 * @param {String} userId - Discord user ID
 * @param {String} username - Discord username
 * @param {String} guildId - Discord guild/server ID
 * @param {String} guildName - Discord guild/server name
 * @param {String} channelId - Voice channel ID
 * @param {String} channelName - Voice channel name
 * @returns {Promise<Object>} - Updated stream activity
 */
const startStreamSession = async (userId, username, guildId, guildName, channelId, channelName) => {
  try {
    // Get or create the user's stream activity record
    const streamActivity = await getOrCreateStreamActivity(userId, username, guildId, guildName);
    
    // End any existing stream first
    await endStreamSession(userId, guildId);
    
    // Start a new stream
    streamActivity.startStream(channelId, channelName);
    await streamActivity.save();
    
    return streamActivity;
  } catch (error) {
    console.error('Error in startStreamSession:', error);
    throw error;
  }
};

/**
 * Ends a user's stream session
 * 
 * @param {String} userId - Discord user ID
 * @param {String} guildId - Discord guild/server ID
 * @returns {Promise<Object|null>} - Updated stream activity and session details, or null if no active stream
 */
const endStreamSession = async (userId, guildId) => {
  try {
    const streamActivity = await StreamActivity.findOne({ userId, guildId });
    
    // Only proceed if we found an activity record with streams
    if (!streamActivity || !streamActivity.streams.length) {
      return { streamActivity: null, sessionDetails: null };
    }
    
    const latestStream = streamActivity.streams[streamActivity.streams.length - 1];
    
    // Only end if there's an active stream (no endTime)
    if (!latestStream.endTime) {
      streamActivity.endStream();
      await streamActivity.save();
      
      // Return the ended stream session details
      return {
        streamActivity,
        sessionDetails: {
          startTime: latestStream.startTime,
          endTime: latestStream.endTime,
          duration: latestStream.duration,
          channelName: latestStream.channelName
        }
      };
    }
    
    return { streamActivity: null, sessionDetails: null };
  } catch (error) {
    console.error('Error in endStreamSession:', error);
    throw error;
  }
};

/**
 * Get streaming statistics for a user
 * 
 * @param {String} userId - Discord user ID
 * @param {String} guildId - Discord guild/server ID
 * @param {String} period - Time period (day, week, month, all)
 * @returns {Promise<Object>} - Stream statistics
 */
const getUserStreamStats = async (userId, guildId, period = 'all') => {
  try {
    const streamActivity = await StreamActivity.findOne({ userId, guildId });
    
    // Return default stats if no activity found
    if (!streamActivity) {
      return {
        totalStreamTime: 0,
        totalStreams: 0,
        periodStats: null
      };
    }
    
    // Get period stats using the helper method
    const periodStats = streamActivity.getCurrentPeriodStats(period);
    
    return {
      totalStreamTime: streamActivity.totalStreamTime,
      totalStreams: streamActivity.totalStreams,
      periodStats,
      lastUpdated: streamActivity.lastUpdated
    };
  } catch (error) {
    console.error('Error in getUserStreamStats:', error);
    throw error;
  }
};

/**
 * Get server streaming leaderboard
 * 
 * @param {String} guildId - Discord guild/server ID
 * @param {String} period - Time period (day, week, month, all)
 * @param {Number} limit - Number of users to include in leaderboard
 * @returns {Promise<Array>} - Leaderboard data
 */
const getServerStreamLeaderboard = async (guildId, period = 'all', limit = 10) => {
  try {
    const users = await StreamActivity.find({ guildId });
    
    if (!users || users.length === 0) {
      return [];
    }
    
    // Calculate leaderboard data based on period
    const leaderboardData = users.map(user => {
      let streamTime = 0;
      let streamCount = 0;
      
      // Extract the appropriate stats based on the requested period
      switch(period) {
        case 'day':
          if (user.currentDailyTotal) {
            streamTime = user.currentDailyTotal.totalMinutes;
            streamCount = user.currentDailyTotal.streamCount;
          }
          break;
        case 'week':
          if (user.currentWeeklyTotal) {
            streamTime = user.currentWeeklyTotal.totalMinutes;
            streamCount = user.currentWeeklyTotal.streamCount;
          }
          break;
        case 'month':
          if (user.currentMonthlyTotal) {
            streamTime = user.currentMonthlyTotal.totalMinutes;
            streamCount = user.currentMonthlyTotal.streamCount;
          }
          break;
        default:
          // 'all' - use total stats
          streamTime = user.totalStreamTime;
          streamCount = user.totalStreams;
      }
      
      return {
        userId: user.userId,
        username: user.username,
        streamTime,
        streamCount
      };
    });
    
    // Sort by streamTime, filter out users with no streams, and limit results
    return leaderboardData
      .filter(user => user.streamTime > 0)
      .sort((a, b) => b.streamTime - a.streamTime)
      .slice(0, limit);
  } catch (error) {
    console.error('Error in getServerStreamLeaderboard:', error);
    throw error;
  }
};

/**
 * Get active stream for a user
 * 
 * @param {String} userId - Discord user ID
 * @param {String} guildId - Discord guild/server ID
 * @returns {Promise<Object|null>} - Active stream or null
 */
const getActiveStream = async (userId, guildId) => {
  try {
    const streamActivity = await StreamActivity.findOne({ userId, guildId });
    
    // Check if there are any streams and if the latest one is active
    if (streamActivity?.streams?.length) {
      const latestStream = streamActivity.streams[streamActivity.streams.length - 1];
      
      if (!latestStream.endTime) {
        // Calculate current duration in minutes
        const duration = Math.floor((new Date() - latestStream.startTime) / (1000 * 60));
        
        return {
          startTime: latestStream.startTime,
          channelId: latestStream.channelId,
          channelName: latestStream.channelName,
          duration
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error in getActiveStream:', error);
    throw error;
  }
};

/**
 * Format minutes into a readable "Xh Ym" format
 * 
 * @param {number} minutes - Total number of minutes
 * @return {string} Formatted time string
 */
function formatTime(minutes) {
  if (minutes < 1) return '0m';
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.floor(minutes % 60);
  
  if (hours === 0) return `${remainingMinutes}m`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format stream duration for display with interrupted status
 * 
 * @param {number} duration - Duration in seconds
 * @param {boolean} interrupted - Whether the stream was interrupted
 * @returns {string} - Formatted duration string
 */
function formatDuration(duration, interrupted = false) {
  if (interrupted) {
    return 'Interrupted';
  }
  
  // Convert seconds to minutes for formatTime
  const minutes = duration / 60;
  return formatTime(minutes);
}

/**
 * Save notification message ID for a stream session
 * 
 * @param {String} userId - Discord user ID
 * @param {String} guildId - Discord guild/server ID
 * @param {String} messageId - Notification message ID
 * @param {String} channelId - Notification channel ID
 * @returns {Promise<Boolean>} - Success status
 */
const saveStreamNotificationId = async (userId, guildId, messageId, channelId) => {
  try {
    const streamActivity = await StreamActivity.findOne({ userId, guildId });
    
    // Only update if there's an active stream
    if (streamActivity?.streams?.length) {
      const latestStream = streamActivity.streams[streamActivity.streams.length - 1];
      
      if (!latestStream.endTime) {
        latestStream.notificationMessageId = messageId;
        latestStream.notificationChannelId = channelId;
        await streamActivity.save();
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error in saveStreamNotificationId:', error);
    return false;
  }
};

/**
 * Get the notification message ID for the latest stream
 * 
 * @param {String} userId - Discord user ID
 * @param {String} guildId - Discord guild/server ID
 * @returns {Promise<Object|null>} - Message ID and channel ID or null
 */
const getStreamNotificationId = async (userId, guildId) => {
  try {
    const streamActivity = await StreamActivity.findOne({ userId, guildId });
    
    if (streamActivity?.streams?.length) {
      const latestStream = streamActivity.streams[streamActivity.streams.length - 1];
      
      if (latestStream.notificationMessageId && latestStream.notificationChannelId) {
        return {
          messageId: latestStream.notificationMessageId,
          channelId: latestStream.notificationChannelId
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error in getStreamNotificationId:', error);
    return null;
  }
};

/**
 * Get stream history for a user
 * 
 * @param {String} userId - Discord user ID
 * @param {String} guildId - Discord guild/server ID
 * @param {Number} limit - Number of sessions to return (0 for all)
 * @returns {Promise<Array>} - Array of stream sessions
 */
const getUserStreamHistory = async (userId, guildId, limit = 0) => {
  try {
    const streamActivity = await StreamActivity.findOne({ userId, guildId });
    
    if (!streamActivity?.streams?.length) {
      return [];
    }
    
    // Sort streams in reverse chronological order
    const sortedStreams = [...streamActivity.streams]
      .filter(stream => stream.endTime) // Only return completed streams
      .sort((a, b) => b.startTime - a.startTime);
    
    // Apply limit if specified
    const limitedStreams = limit > 0 ? sortedStreams.slice(0, limit) : sortedStreams;
    
    return limitedStreams.map(stream => {
      // For interrupted streams, return a simplified object
      if (stream.interrupted) {
        return {
          startTime: stream.startTime,
          channelName: stream.channelName,
          channelId: stream.channelId,
          day: stream.day,
          interrupted: true
        };
      }
      
      // For regular streams, return full details
      return {
        startTime: stream.startTime,
        endTime: stream.endTime,
        duration: stream.duration,
        channelName: stream.channelName,
        channelId: stream.channelId,
        day: stream.day,
        interrupted: false
      };
    });
  } catch (error) {
    console.error('Error in getUserStreamHistory:', error);
    throw error;
  }
};

/**
 * Mark a stream session as interrupted (for crash recovery)
 * 
 * @param {String} userId - Discord user ID
 * @param {String} guildId - Discord guild/server ID
 * @returns {Promise<Object|null>} - Updated stream activity and session details, or null if no active stream
 */
const markStreamAsInterrupted = async (userId, guildId) => {
  try {
    const streamActivity = await StreamActivity.findOne({ userId, guildId });
    
    if (!streamActivity?.streams?.length) {
      return { streamActivity: null, sessionDetails: null };
    }
    
    const latestStream = streamActivity.streams[streamActivity.streams.length - 1];
    
    // Only mark as interrupted if there's an active stream
    if (!latestStream.endTime) {
      // Add an interrupted flag
      latestStream.interrupted = true;
      
      // Set end time to current time
      latestStream.endTime = new Date();
      
      // Calculate duration in minutes but don't use it for stats
      const duration = Math.floor((latestStream.endTime - latestStream.startTime) / (1000 * 60));
      latestStream.duration = duration;
      
      // For interrupted streams, only increment stream counts, not durations
      streamActivity.totalStreams += 1;
      
      // Update period totals - increment counts only
      if (streamActivity.currentDailyTotal) {
        streamActivity.currentDailyTotal.streamCount += 1;
      }
      
      if (streamActivity.currentWeeklyTotal) {
        streamActivity.currentWeeklyTotal.streamCount += 1;
      }
      
      if (streamActivity.currentMonthlyTotal) {
        streamActivity.currentMonthlyTotal.streamCount += 1;
      }
      
      streamActivity.lastUpdated = new Date();
      await streamActivity.save();
      
      return {
        streamActivity,
        sessionDetails: {
          startTime: latestStream.startTime,
          endTime: latestStream.endTime,
          duration: latestStream.duration,
          channelName: latestStream.channelName,
          interrupted: true
        }
      };
    }
    
    return { streamActivity: null, sessionDetails: null };
  } catch (error) {
    console.error('Error in markStreamAsInterrupted:', error);
    throw error;
  }
};

/**
 * Get all active streams across all guilds
 * 
 * @returns {Promise<Array>} - List of active streams
 */
const getAllActiveStreams = async () => {
  try {
    // Check if mongoose is connected before attempting operations
    if (mongoose.connection.readyState !== 1) {
      console.warn('MongoDB is not connected. Cannot get active streams.');
      return [];
    }

    // Find all activities with active streams (where the last stream has no end time)
    const activeStreamActivities = await StreamActivity.find({
      'streams': { 
        $elemMatch: { 
          'endTime': null 
        } 
      }
    });
    
    // Extract the relevant information for each active stream
    return activeStreamActivities.reduce((activeStreams, activity) => {
      const latestStream = activity.streams[activity.streams.length - 1];
      
      if (!latestStream.endTime) {
        activeStreams.push({
          userId: activity.userId,
          username: activity.username,
          guildId: activity.guildId,
          guildName: activity.guildName,
          channelId: latestStream.channelId,
          channelName: latestStream.channelName,
          startTime: latestStream.startTime
        });
      }
      
      return activeStreams;
    }, []);
  } catch (error) {
    console.error('Error in getAllActiveStreams:', error);
    // Return empty array instead of throwing, to avoid crashing the application
    return [];
  }
};

module.exports = {
  getOrCreateStreamActivity,
  startStreamSession,
  endStreamSession,
  getUserStreamStats,
  getServerStreamLeaderboard,
  getActiveStream,
  formatTime,
  formatDuration,
  saveStreamNotificationId,
  getStreamNotificationId,
  getUserStreamHistory,
  markStreamAsInterrupted,
  getAllActiveStreams
}; 