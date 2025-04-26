const mongoose = require('mongoose');

const streamActivitySchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  username: {
    type: String,
    required: true
  },
  guildId: {
    type: String,
    required: true,
    index: true
  },
  guildName: {
    type: String,
    required: true
  },
  streams: [{
    startTime: {
      type: Date,
      required: true
    },
    endTime: {
      type: Date,
      default: null
    },
    channelId: {
      type: String,
      required: true
    },
    channelName: {
      type: String,
      required: true
    },
    duration: {
      type: Number,
      default: 0 // Duration in minutes
    },
    day: {
      type: String, // Format: YYYY-MM-DD
      required: true
    },
    week: {
      type: String, // Format: YYYY-WW (ISO week)
      required: true
    },
    month: {
      type: String, // Format: YYYY-MM
      required: true
    },
    interrupted: {
      type: Boolean,
      default: false
    },
    notificationMessageId: {
      type: String,
      default: null
    },
    notificationChannelId: {
      type: String,
      default: null
    }
  }],
  // Daily totals - with just one current entry
  currentDailyTotal: {
    day: {
      type: String, // Format: YYYY-MM-DD
      required: true,
      default: () => new Date().toISOString().split('T')[0]
    },
    totalMinutes: {
      type: Number,
      default: 0
    },
    streamCount: {
      type: Number,
      default: 0
    }
  },
  // Weekly totals - with just one current entry
  currentWeeklyTotal: {
    week: {
      type: String, // Format: YYYY-WW (ISO week)
      required: true,
      default: () => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
        return date.getFullYear() + '-' + 
          String(Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 4).getTime()) / 
          (7 * 24 * 60 * 60 * 1000)) + 1).padStart(2, '0');
      }
    },
    totalMinutes: {
      type: Number,
      default: 0
    },
    streamCount: {
      type: Number,
      default: 0
    }
  },
  // Monthly totals - with just one current entry
  currentMonthlyTotal: {
    month: {
      type: String, // Format: YYYY-MM
      required: true,
      default: () => new Date().toISOString().slice(0, 7)
    },
    totalMinutes: {
      type: Number,
      default: 0
    },
    streamCount: {
      type: Number,
      default: 0
    }
  },
  totalStreams: {
    type: Number,
    default: 0
  },
  totalStreamTime: {
    type: Number,
    default: 0 // Total time in minutes
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Helper function to get time period strings
streamActivitySchema.methods.getTimePeriods = function() {
  const now = new Date();
  const day = now.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Get ISO week
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week = date.getFullYear() + '-' + 
    String(Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 4).getTime()) / 
    (7 * 24 * 60 * 60 * 1000)) + 1).padStart(2, '0');
  
  // Get month
  const month = now.toISOString().slice(0, 7); // YYYY-MM
  
  return { day, week, month };
};

// Method to start a new stream session
streamActivitySchema.methods.startStream = function(channelId, channelName) {
  const { day, week, month } = this.getTimePeriods();
  
  this.streams.push({
    startTime: new Date(),
    channelId,
    channelName,
    day,
    week,
    month
  });
  
  // Initialize current period totals if they don't exist
  if (!this.currentDailyTotal || !this.currentDailyTotal.day) {
    this.currentDailyTotal = { day, totalMinutes: 0, streamCount: 0 };
  }
  
  if (!this.currentWeeklyTotal || !this.currentWeeklyTotal.week) {
    this.currentWeeklyTotal = { week, totalMinutes: 0, streamCount: 0 };
  }
  
  if (!this.currentMonthlyTotal || !this.currentMonthlyTotal.month) {
    this.currentMonthlyTotal = { month, totalMinutes: 0, streamCount: 0 };
  }
  
  this.lastUpdated = new Date();
};

// Method to end the latest stream session
streamActivitySchema.methods.endStream = function() {
  if (this.streams.length > 0) {
    const latestStream = this.streams[this.streams.length - 1];
    if (!latestStream.endTime) {
      // Get current time periods when the stream ends
      const currentPeriods = this.getTimePeriods();
      
      latestStream.endTime = new Date();
      const duration = Math.floor((latestStream.endTime - latestStream.startTime) / (1000 * 60)); // Convert to minutes
      latestStream.duration = duration;
      this.totalStreamTime += duration;
      this.totalStreams += 1;
      
      // Initialize current period totals if they don't exist (migration support)
      if (!this.currentDailyTotal || !this.currentDailyTotal.day) {
        this.currentDailyTotal = { day: currentPeriods.day, totalMinutes: 0, streamCount: 0 };
      }
      
      if (!this.currentWeeklyTotal || !this.currentWeeklyTotal.week) {
        this.currentWeeklyTotal = { week: currentPeriods.week, totalMinutes: 0, streamCount: 0 };
      }
      
      if (!this.currentMonthlyTotal || !this.currentMonthlyTotal.month) {
        this.currentMonthlyTotal = { month: currentPeriods.month, totalMinutes: 0, streamCount: 0 };
      }
      
      // Check if day has changed since last update and reset if needed
      if (this.currentDailyTotal.day !== currentPeriods.day) {
        // Reset for new day
        this.currentDailyTotal = {
          day: currentPeriods.day,
          totalMinutes: 0,
          streamCount: 0
        };
      }
      
      // Check if week has changed since last update and reset if needed
      if (this.currentWeeklyTotal.week !== currentPeriods.week) {
        // Reset for new week
        this.currentWeeklyTotal = {
          week: currentPeriods.week,
          totalMinutes: 0,
          streamCount: 0
        };
      }
      
      // Check if month has changed since last update and reset if needed
      if (this.currentMonthlyTotal.month !== currentPeriods.month) {
        // Reset for new month
        this.currentMonthlyTotal = {
          month: currentPeriods.month,
          totalMinutes: 0,
          streamCount: 0
        };
      }
      
      // Update current daily totals
      this.currentDailyTotal.totalMinutes += duration;
      this.currentDailyTotal.streamCount += 1;
      
      // Update current weekly totals
      this.currentWeeklyTotal.totalMinutes += duration;
      this.currentWeeklyTotal.streamCount += 1;
      
      // Update current monthly totals
      this.currentMonthlyTotal.totalMinutes += duration;
      this.currentMonthlyTotal.streamCount += 1;
      
      this.lastUpdated = new Date();
    }
  }
};

// For backwards compatibility with stats command
streamActivitySchema.methods.getCurrentPeriodStats = function(period) {
  const currentPeriods = this.getTimePeriods();
  
  switch(period) {
    case 'day':
      return {
        day: this.currentDailyTotal.day,
        totalMinutes: this.currentDailyTotal.totalMinutes,
        streamCount: this.currentDailyTotal.streamCount
      };
    case 'week':
      return {
        week: this.currentWeeklyTotal.week,
        totalMinutes: this.currentWeeklyTotal.totalMinutes,
        streamCount: this.currentWeeklyTotal.streamCount
      };
    case 'month':
      return {
        month: this.currentMonthlyTotal.month,
        totalMinutes: this.currentMonthlyTotal.totalMinutes,
        streamCount: this.currentMonthlyTotal.streamCount
      };
    default:
      return {
        totalMinutes: this.totalStreamTime,
        streamCount: this.totalStreams
      };
  }
};

/**
 * Get time-series data for stream activity in a guild
 * @param {string} guildId - Discord guild ID
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>} Array of daily activity data points
 */
streamActivitySchema.statics.getTimeSeriesData = async function(guildId, days = 7) {
  try {
    // Calculate start date (X days ago)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    
    // Find all stream sessions in the given timeframe
    const sessions = await this.find({
      guildId,
      startTime: { $gte: startDate }
    }).sort({ startTime: 1 });
    
    // Create array of days to track
    const daysArray = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      daysArray.push({
        date: new Date(date),
        minutesStreamed: 0,
        streamCount: 0,
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      });
    }
    
    // Aggregate stream time by day
    sessions.forEach(session => {
      const sessionDate = new Date(session.startTime);
      sessionDate.setHours(0, 0, 0, 0);
      
      // Find matching day in our array
      const dayIndex = daysArray.findIndex(day => 
        day.date.getTime() === sessionDate.getTime()
      );
      
      if (dayIndex !== -1) {
        daysArray[dayIndex].minutesStreamed += session.duration || 0;
        daysArray[dayIndex].streamCount += 1;
      }
    });
    
    return daysArray;
  } catch (error) {
    console.error('Error generating time series data:', error);
    throw error;
  }
};

/**
 * Get time distribution for streams in a guild (hours of day)
 * @param {string} guildId - Discord guild ID
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>} Array of hourly activity data
 */
streamActivitySchema.statics.getHourlyDistribution = async function(guildId, days = 30) {
  try {
    // Calculate start date (X days ago)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Find all stream sessions in the given timeframe
    const sessions = await this.find({
      guildId,
      startTime: { $gte: startDate }
    });
    
    // Create array of hours (0-23)
    const hourlyData = Array(24).fill(0).map((_, i) => ({
      hour: i,
      streamCount: 0,
      label: `${i}:00`
    }));
    
    // Count streams by hour they started
    sessions.forEach(session => {
      const hour = new Date(session.startTime).getHours();
      hourlyData[hour].streamCount += 1;
    });
    
    return hourlyData;
  } catch (error) {
    console.error('Error getting hourly distribution:', error);
    return [];
  }
};

const StreamActivity = mongoose.model('StreamActivity', streamActivitySchema);

module.exports = StreamActivity; 