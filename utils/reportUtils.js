const { EmbedBuilder } = require('discord.js');
const StreamActivity = require('../models/StreamActivity');
const { formatDuration } = require('./streamUtils');
const { createPaginatedEmbed } = require('./paginationUtils');
const logger = require('./logger');

// Maximum number of streams to show per page in reports
const MAX_STREAMS_PER_PAGE = 6;

/**
 * Generate hourly stream report for a guild
 * @param {string} guildId - The guild ID
 * @param {Date} startTime - Start time for the report period
 * @returns {Promise<Array<EmbedBuilder>>} - Array of report embeds for pagination
 */
async function generateHourlyReport(guildId, startTime = null) {
    try {
        const requestId = logger.startRequest('report:hourly', { guildId, customStartTime: !!startTime });
        
        // Default to last hour if no start time provided
        if (!startTime) {
            startTime = new Date();
            startTime.setHours(startTime.getHours() - 1);
        }
        
        const endTime = new Date();
        
        // Debug logging
        logger.debug(`Generating hourly report for period: ${startTime.toISOString()} to ${endTime.toISOString()}`, { requestId });
        
        // Query streams that were active in the last hour
        logger.addRequestStep(requestId, 'querying-database');
        const streamActivities = await StreamActivity.find({
            guildId: guildId,
            streams: {
                $elemMatch: {
                    $or: [
                        // Streams that started in the time period
                        { startTime: { $gte: startTime, $lte: endTime } },
                        // Streams that ended in the time period (only if endTime exists)
                        { 
                            endTime: { $exists: true, $ne: null },
                            endTime: { $gte: startTime, $lte: endTime }
                        },
                        // Streams that were active through the time period (started before, ended after or still active)
                        { 
                            $and: [
                                { startTime: { $lte: startTime } },
                                { $or: [
                                    { 
                                        endTime: { $exists: true, $ne: null },
                                        endTime: { $gte: endTime }
                                    },
                                    { endTime: { $exists: false } },
                                    { endTime: null }
                                ]}
                            ]
                        }
                    ]
                }
            }
        });
        
        logger.addRequestStep(requestId, 'processing-streams');
        // Extract and process relevant streams from each activity
        const processedStreams = [];
        const userStreamCounts = new Map(); // Track streams per user to detect overlaps
        
        for (const activity of streamActivities) {
            const userId = activity.userId;
            
            // Initialize user stream count tracking
            if (!userStreamCounts.has(userId)) {
                userStreamCounts.set(userId, new Set());
            }
            
            for (const stream of activity.streams) {
                // Check if the stream was active during the time period
                const streamStartInPeriod = stream.startTime >= startTime && stream.startTime <= endTime;
                const streamEndInPeriod = stream.endTime && stream.endTime >= startTime && stream.endTime <= endTime;
                const streamSpansPeriod = stream.startTime <= startTime && (!stream.endTime || stream.endTime >= endTime);
                
                if (streamStartInPeriod || streamEndInPeriod || streamSpansPeriod) {
                    // Create a unique identifier for this stream to detect duplicates
                    const streamId = `${stream.startTime.getTime()}-${stream.channelId}`;
                    
                    // Skip if we've already processed this exact stream for this user
                    if (userStreamCounts.get(userId).has(streamId)) {
                        logger.debug(`Skipping duplicate stream for user ${userId}: ${streamId}`, { requestId });
                        continue;
                    }
                    
                    userStreamCounts.get(userId).add(streamId);
                    
                    // Determine if this is an incomplete/ongoing stream
                    const isIncomplete = !stream.endTime || stream.endTime === 'Unknown';
                    
                    processedStreams.push({
                        userId: activity.userId,
                        username: activity.username,
                        startTime: stream.startTime,
                        endTime: stream.endTime,
                        channelId: stream.channelId,
                        channelName: stream.channelName,
                        interrupted: stream.interrupted || false,
                        isIncomplete: isIncomplete,
                        duration: stream.duration || 0
                    });
                }
            }
        }
        
        // Sort streams by start time (newest first)
        processedStreams.sort((a, b) => b.startTime - a.startTime);
        
        logger.debug(`Found ${processedStreams.length} streams for hourly report (after deduplication)`, { 
            requestId, 
            streamCount: processedStreams.length,
            incompleteCount: processedStreams.filter(s => s.isIncomplete).length
        });
        
        // Create base embed that all pages will extend
        const baseEmbed = new EmbedBuilder()
            .setTitle('📊 Hourly Stream Report')
            .setColor('#0099ff')
            .setDescription(`Stream activity in the last hour (${startTime.toLocaleString()} - ${endTime.toLocaleString()})`)
            .setTimestamp();
        
        // If no streams, return a single embed
        if (processedStreams.length === 0) {
            baseEmbed.addFields([{ name: 'No Streams', value: 'No streaming activity in the past hour.' }]);
            logger.endRequest(requestId, true, { pages: 1 });
            return [baseEmbed];
        }
        
        // Group streams by user and calculate statistics
        const userStreams = {};
        let totalStreamTime = 0;
        let totalStreamCount = 0;
        let incompleteStreamCount = 0;
        
        processedStreams.forEach(stream => {
            const userId = stream.userId;
            if (!userStreams[userId]) {
                userStreams[userId] = {
                    username: stream.username,
                    streamCount: 0,
                    totalDuration: 0,
                    incompleteCount: 0,
                    streams: []
                };
            }
            
            // Calculate duration within the report period
            let durationSec = 0;
            
            if (stream.isIncomplete) {
                // For incomplete streams, calculate duration from start to end of report period
                const streamStart = stream.startTime > startTime ? stream.startTime : startTime;
                const streamEnd = endTime; // Use end of report period for ongoing streams
                durationSec = Math.max(0, Math.round((streamEnd - streamStart) / 1000));
                incompleteStreamCount++;
                userStreams[userId].incompleteCount++;
            } else {
                // For complete streams, use actual duration or calculate within period
                if (stream.duration && stream.duration > 0) {
                    durationSec = stream.duration * 60; // Convert minutes to seconds
                } else {
                    const streamStart = stream.startTime > startTime ? stream.startTime : startTime;
                    const streamEnd = stream.endTime && stream.endTime < endTime ? stream.endTime : endTime;
                    durationSec = Math.max(0, Math.round((streamEnd - streamStart) / 1000));
                }
            }
            
            userStreams[userId].streamCount++;
            userStreams[userId].totalDuration += durationSec;
            userStreams[userId].streams.push({
                channelId: stream.channelId,
                channelName: stream.channelName,
                startTime: stream.startTime,
                endTime: stream.endTime,
                duration: durationSec,
                interrupted: stream.interrupted,
                isIncomplete: stream.isIncomplete
            });
            
            totalStreamTime += durationSec;
            totalStreamCount++;
        });
        
        // Create summary field that will be on all pages
        const summaryField = { 
            name: 'Summary', 
            value: `**Total Streams:** ${totalStreamCount}\n` + 
                   `**Complete Streams:** ${totalStreamCount - incompleteStreamCount}\n` +
                   `**Ongoing/Unknown Streams:** ${incompleteStreamCount}\n` +
                   `**Total Streaming Time:** ${formatDuration(totalStreamTime)}\n` +
                   `**Unique Streamers:** ${Object.keys(userStreams).length}`
        };
        
        // Create an array to hold all stream entries that need to be displayed
        const allStreamEntries = [];
        
        // Prepare stream entries
        Object.keys(userStreams).forEach(userId => {
            const user = userStreams[userId];
            
            // Create a user header entry
            allStreamEntries.push({
                type: 'user-header',
                username: user.username,
                streamCount: user.streamCount,
                totalDuration: user.totalDuration,
                incompleteCount: user.incompleteCount
            });
            
            // Add each stream from this user
            user.streams.forEach(stream => {
                allStreamEntries.push({
                    type: 'stream',
                    stream: stream
                });
            });
        });
        
        // We'll calculate the actual page count as we create pages
        let estimatedPageCount = Math.ceil(totalStreamCount / MAX_STREAMS_PER_PAGE);
        
        logger.addRequestStep(requestId, 'creating-pages', { pageCount, totalStreams: totalStreamCount });
        
        // Create an array of embeds, one for each page
        const embeds = [];
        
        // Initialize counters
        let currentPage = 0;
        let streamsOnCurrentPage = 0;
        let currentEmbed = null;
        let currentUserContent = '';
        let currentUserId = null;
        
        // Iterate through all entries to create pages
        for (let i = 0; i < allStreamEntries.length; i++) {
            const entry = allStreamEntries[i];
            
            // Create a new embed if we're starting or if we've hit the limit for the current page
            if (!currentEmbed || (streamsOnCurrentPage >= MAX_STREAMS_PER_PAGE && entry.type === 'user-header')) {
                // If we have a current embed, finish and add it
                if (currentEmbed && currentUserContent) {
                    // Add the last user content if any
                    const user = userStreams[currentUserId];
                    const incompleteText = user.incompleteCount > 0 ? ` (${user.incompleteCount} ongoing/unknown)` : '';
                    currentEmbed.addFields([{ 
                        name: `${user.username} (${user.streamCount} stream${user.streamCount !== 1 ? 's' : ''}${incompleteText})`,
                        value: `**Total Time:** ${formatDuration(user.totalDuration)}\n${currentUserContent}`
                    }]);
                    
                    embeds.push(currentEmbed);
                }
                
                // Create a new embed
                currentEmbed = new EmbedBuilder()
                    .setTitle(baseEmbed.data.title)
                    .setColor(baseEmbed.data.color)
                    .setDescription(baseEmbed.data.description)
                    .setTimestamp();
                
                // Add summary field to every page
                currentEmbed.addFields([summaryField]);
                
                // Add page indicator to title if multiple pages
                if (estimatedPageCount > 1) {
                    // We'll update this later with the actual page count
                    currentEmbed.setTitle(`📊 Hourly Stream Report (Page ${currentPage+1})`);
                }
                
                // Reset counters for the new page
                currentPage++;
                streamsOnCurrentPage = 0;
                currentUserContent = '';
                currentUserId = null;
            }
            
            // Process the current entry
            if (entry.type === 'user-header') {
                // If we were processing a different user, add their field first
                if (currentUserId !== null && currentUserContent) {
                    const user = userStreams[currentUserId];
                    const incompleteText = user.incompleteCount > 0 ? ` (${user.incompleteCount} ongoing/unknown)` : '';
                    currentEmbed.addFields([{ 
                        name: `${user.username} (${user.streamCount} stream${user.streamCount !== 1 ? 's' : ''}${incompleteText})`,
                        value: `**Total Time:** ${formatDuration(user.totalDuration)}\n${currentUserContent}`
                    }]);
                    
                    currentUserContent = '';
                }
                
                // Set the current user
                currentUserId = Object.keys(userStreams).find(id => userStreams[id].username === entry.username);
                
            } else if (entry.type === 'stream') {
                // Add stream details to the current user's content
                const stream = entry.stream;
                
                // Format timestamps for readability
                const startTimeStr = stream.startTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
                
                let endTimeStr, statusText;
                if (stream.isIncomplete) {
                    endTimeStr = 'Unknown';
                    statusText = 'Status: Ongoing/Unknown';
                } else if (stream.endTime) {
                    endTimeStr = stream.endTime.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true
                    });
                    statusText = stream.interrupted ? 'Status: Interrupted' : 'Status: Completed';
                } else {
                    endTimeStr = 'Now';
                    statusText = 'Status: Still streaming';
                }
                
                currentUserContent += `• <#${stream.channelId}> (${stream.channelName})\n`;
                currentUserContent += `  • Started: ${startTimeStr}\n`;
                currentUserContent += `  • Ended: ${endTimeStr}\n`;
                currentUserContent += `  • Duration: ${formatDuration(stream.duration)}\n`;
                currentUserContent += `  • ${statusText}\n\n`;
                
                // Increment the stream counter for the current page
                streamsOnCurrentPage++;
            }
        }
        
        // Add the last user and embed if not already added
        if (currentEmbed && currentUserContent) {
            const user = userStreams[currentUserId];
            const incompleteText = user.incompleteCount > 0 ? ` (${user.incompleteCount} ongoing/unknown)` : '';
            currentEmbed.addFields([{ 
                name: `${user.username} (${user.streamCount} stream${user.streamCount !== 1 ? 's' : ''}${incompleteText})`,
                value: `**Total Time:** ${formatDuration(user.totalDuration)}\n${currentUserContent}`
            }]);
            
            embeds.push(currentEmbed);
        }
        
        // Now update all embeds with the correct page count
        const actualPageCount = embeds.length;
        if (actualPageCount > 1) {
            embeds.forEach((embed, index) => {
                embed.setTitle(`📊 Hourly Stream Report (Page ${index + 1}/${actualPageCount})`);
            });
        }
        
        logger.endRequest(requestId, true, { 
            streams: totalStreamCount, 
            users: Object.keys(userStreams).length, 
            pages: actualPageCount,
            incompleteStreams: incompleteStreamCount
        });
        return embeds;
    } catch (error) {
        logger.error('Error generating hourly report:', { error: error.message, stack: error.stack });
        
        // Return a basic error embed
        const errorEmbed = new EmbedBuilder()
            .setTitle('⚠️ Error Generating Report')
            .setColor('#ff0000')
            .setDescription(`An error occurred while generating the stream report: ${error.message}`)
            .setTimestamp();
        
        return [errorEmbed];
    }
}

/**
 * Generate daily stream report for a guild
 * @param {string} guildId - The guild ID
 * @returns {Promise<Array<EmbedBuilder>>} - Array of report embeds for pagination
 */
async function generateDailyReport(guildId) {
    try {
        const requestId = logger.startRequest('report:daily', { guildId });
        
        // Get the guild's timezone
        const GuildConfig = require('../models/GuildConfig');
        const guildConfig = await GuildConfig.findOne({ guildId });
        const timezone = guildConfig?.timezone || 'UTC';
        
        // Get current time in the guild's timezone
        const now = new Date();
        
        // Get start of PREVIOUS day in the guild's timezone
        const startTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        startTime.setDate(startTime.getDate() - 1); // Go back 1 day
        startTime.setHours(0, 0, 0, 0); // Set to start of that day
        
        // Get end of PREVIOUS day in the guild's timezone
        const endTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        endTime.setDate(endTime.getDate() - 1); // Go back 1 day
        endTime.setHours(23, 59, 59, 999); // Set to end of that day
        
        // Debug logging
        logger.debug(`Generating daily report for previous day: ${startTime.toISOString()} to ${endTime.toISOString()} in timezone ${timezone}`, { requestId });
        
        // Query streams that were active in the previous day
        logger.addRequestStep(requestId, 'querying-database');
        const streamActivities = await StreamActivity.find({
            guildId: guildId,
            streams: {
                $elemMatch: {
                    $or: [
                        // Streams that started in the time period
                        { startTime: { $gte: startTime, $lte: endTime } },
                        // Streams that ended in the time period (only if endTime exists)
                        { 
                            endTime: { $exists: true, $ne: null },
                            endTime: { $gte: startTime, $lte: endTime }
                        },
                        // Streams that were active through the time period (started before, ended after or still active)
                        { 
                            $and: [
                                { startTime: { $lte: startTime } },
                                { $or: [
                                    { 
                                        endTime: { $exists: true, $ne: null },
                                        endTime: { $gte: endTime }
                                    },
                                    { endTime: { $exists: false } },
                                    { endTime: null }
                                ]}
                            ]
                        }
                    ]
                }
            }
        });
        
        logger.addRequestStep(requestId, 'processing-streams');
        // Extract and process relevant streams from each activity
        const processedStreams = [];
        const userStreamCounts = new Map(); // Track streams per user to detect overlaps
        
        for (const activity of streamActivities) {
            const userId = activity.userId;
            
            // Initialize user stream count tracking
            if (!userStreamCounts.has(userId)) {
                userStreamCounts.set(userId, new Set());
            }
            
            for (const stream of activity.streams) {
                // Check if the stream was active during the time period
                const streamStartInPeriod = stream.startTime >= startTime && stream.startTime <= endTime;
                const streamEndInPeriod = stream.endTime && stream.endTime >= startTime && stream.endTime <= endTime;
                const streamSpansPeriod = stream.startTime <= startTime && (!stream.endTime || stream.endTime >= endTime);
                
                if (streamStartInPeriod || streamEndInPeriod || streamSpansPeriod) {
                    // Create a unique identifier for this stream to detect duplicates
                    const streamId = `${stream.startTime.getTime()}-${stream.channelId}`;
                    
                    // Skip if we've already processed this exact stream for this user
                    if (userStreamCounts.get(userId).has(streamId)) {
                        logger.debug(`Skipping duplicate stream for user ${userId}: ${streamId}`, { requestId });
                        continue;
                    }
                    
                    userStreamCounts.get(userId).add(streamId);
                    
                    // Determine if this is an incomplete/ongoing stream
                    const isIncomplete = !stream.endTime || stream.endTime === 'Unknown';
                    
                    processedStreams.push({
                        userId: activity.userId,
                        username: activity.username,
                        startTime: stream.startTime,
                        endTime: stream.endTime,
                        channelId: stream.channelId,
                        channelName: stream.channelName,
                        interrupted: stream.interrupted || false,
                        isIncomplete: isIncomplete,
                        duration: stream.duration || 0
                    });
                }
            }
        }
        
        // Sort streams by start time (newest first)
        processedStreams.sort((a, b) => b.startTime - a.startTime);
        
        logger.debug(`Found ${processedStreams.length} streams for daily report (after deduplication)`, { 
            requestId, 
            streamCount: processedStreams.length,
            incompleteCount: processedStreams.filter(s => s.isIncomplete).length
        });
        
        const dateStr = startTime.toLocaleDateString('en-US', { timeZone: timezone });
        
        // Create base embed that all pages will extend
        const baseEmbed = new EmbedBuilder()
            .setTitle('📈 Daily Stream Report')
            .setColor('#00cc99')
            .setDescription(`Stream activity for ${dateStr} (${timezone} timezone)`)
            .setTimestamp();
        
        // If no streams, return a single embed
        if (processedStreams.length === 0) {
            baseEmbed.addFields([{ name: 'No Streams', value: `No streaming activity on ${dateStr}.` }]);
            logger.endRequest(requestId, true, { pages: 1 });
            return [baseEmbed];
        }
        
        // Group streams by user and calculate statistics
        const userStreams = {};
        let totalStreamTime = 0;
        let totalStreamCount = 0;
        let incompleteStreamCount = 0;
        
        processedStreams.forEach(stream => {
            const userId = stream.userId;
            if (!userStreams[userId]) {
                userStreams[userId] = {
                    username: stream.username,
                    streamCount: 0,
                    totalDuration: 0,
                    incompleteCount: 0,
                    streams: []
                };
            }
            
            // Calculate duration within the report period
            let durationSec = 0;
            
            if (stream.isIncomplete) {
                // For incomplete streams, calculate duration from start to end of report period
                const streamStart = stream.startTime > startTime ? stream.startTime : startTime;
                const streamEnd = endTime; // Use end of report period for ongoing streams
                durationSec = Math.max(0, Math.round((streamEnd - streamStart) / 1000));
                incompleteStreamCount++;
                userStreams[userId].incompleteCount++;
            } else {
                // For complete streams, use actual duration or calculate within period
                if (stream.duration && stream.duration > 0) {
                    durationSec = stream.duration * 60; // Convert minutes to seconds
                } else {
                    const streamStart = stream.startTime > startTime ? stream.startTime : startTime;
                    const streamEnd = stream.endTime && stream.endTime < endTime ? stream.endTime : endTime;
                    durationSec = Math.max(0, Math.round((streamEnd - streamStart) / 1000));
                }
            }
            
            userStreams[userId].streamCount++;
            userStreams[userId].totalDuration += durationSec;
            userStreams[userId].streams.push({
                channelId: stream.channelId,
                channelName: stream.channelName,
                startTime: stream.startTime,
                endTime: stream.endTime,
                duration: durationSec,
                interrupted: stream.interrupted,
                isIncomplete: stream.isIncomplete
            });
            
            totalStreamTime += durationSec;
            totalStreamCount++;
        });
        
        // Create summary field that will be on all pages
        const summaryField = { 
            name: 'Summary', 
            value: `**Total Streams:** ${totalStreamCount}\n` + 
                   `**Complete Streams:** ${totalStreamCount - incompleteStreamCount}\n` +
                   `**Ongoing/Unknown Streams:** ${incompleteStreamCount}\n` +
                   `**Total Streaming Time:** ${formatDuration(totalStreamTime)}\n` +
                   `**Unique Streamers:** ${Object.keys(userStreams).length}`
        };
        
        // Sort users by total duration (descending)
        const sortedUserIds = Object.keys(userStreams).sort((a, b) => 
            userStreams[b].totalDuration - userStreams[a].totalDuration
        );
        
        // Create an array to hold all stream entries that need to be displayed
        const allStreamEntries = [];
        
        // Prepare stream entries, using sorted user IDs
        sortedUserIds.forEach(userId => {
            const user = userStreams[userId];
            
            // Create a user header entry
            allStreamEntries.push({
                type: 'user-header',
                username: user.username,
                streamCount: user.streamCount,
                totalDuration: user.totalDuration,
                incompleteCount: user.incompleteCount
            });
            
            // Add each stream from this user
            user.streams.forEach(stream => {
                allStreamEntries.push({
                    type: 'stream',
                    stream: stream
                });
            });
        });
        
        // We'll calculate the actual page count as we create pages
        let estimatedPageCount = Math.ceil(totalStreamCount / MAX_STREAMS_PER_PAGE);
        
        logger.addRequestStep(requestId, 'creating-pages', { pageCount, totalStreams: totalStreamCount });
        
        // Create an array of embeds, one for each page
        const embeds = [];
        
        // Initialize counters
        let currentPage = 0;
        let streamsOnCurrentPage = 0;
        let currentEmbed = null;
        let currentUserContent = '';
        let currentUserId = null;
        
        // Iterate through all entries to create pages
        for (let i = 0; i < allStreamEntries.length; i++) {
            const entry = allStreamEntries[i];
            
            // Create a new embed if we're starting or if we've hit the limit for the current page
            if (!currentEmbed || (streamsOnCurrentPage >= MAX_STREAMS_PER_PAGE && entry.type === 'user-header')) {
                // If we have a current embed, finish and add it
                if (currentEmbed && currentUserContent) {
                    // Add the last user content if any
                    const user = userStreams[currentUserId];
                    const incompleteText = user.incompleteCount > 0 ? ` (${user.incompleteCount} ongoing/unknown)` : '';
                    currentEmbed.addFields([{ 
                        name: `${user.username} (${user.streamCount} stream${user.streamCount !== 1 ? 's' : ''}${incompleteText})`,
                        value: `**Total Time:** ${formatDuration(user.totalDuration)}\n${currentUserContent}`
                    }]);
                    
                    embeds.push(currentEmbed);
                }
                
                // Create a new embed
                currentEmbed = new EmbedBuilder()
                    .setTitle(baseEmbed.data.title)
                    .setColor(baseEmbed.data.color)
                    .setDescription(baseEmbed.data.description)
                    .setTimestamp();
                
                // Add summary field to every page
                currentEmbed.addFields([summaryField]);
                
                // Add page indicator to title if multiple pages
                if (estimatedPageCount > 1) {
                    // We'll update this later with the actual page count
                    currentEmbed.setTitle(`📈 Daily Stream Report (Page ${currentPage+1})`);
                }
                
                // Reset counters for the new page
                currentPage++;
                streamsOnCurrentPage = 0;
                currentUserContent = '';
                currentUserId = null;
            }
            
            // Process the current entry
            if (entry.type === 'user-header') {
                // If we were processing a different user, add their field first
                if (currentUserId !== null && currentUserContent) {
                    const user = userStreams[currentUserId];
                    const incompleteText = user.incompleteCount > 0 ? ` (${user.incompleteCount} ongoing/unknown)` : '';
                    currentEmbed.addFields([{ 
                        name: `${user.username} (${user.streamCount} stream${user.streamCount !== 1 ? 's' : ''}${incompleteText})`,
                        value: `**Total Time:** ${formatDuration(user.totalDuration)}\n${currentUserContent}`
                    }]);
                    
                    currentUserContent = '';
                }
                
                // Set the current user
                currentUserId = sortedUserIds.find(id => userStreams[id].username === entry.username);
                
            } else if (entry.type === 'stream') {
                // Add stream details to the current user's content
                const stream = entry.stream;
                
                // Format timestamps for readability
                const startTimeStr = stream.startTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
                
                let endTimeStr, statusText;
                if (stream.isIncomplete) {
                    endTimeStr = 'Unknown';
                    statusText = 'Status: Ongoing/Unknown';
                } else if (stream.endTime) {
                    endTimeStr = stream.endTime.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true
                    });
                    statusText = stream.interrupted ? 'Status: Interrupted' : 'Status: Completed';
                } else {
                    endTimeStr = 'Now';
                    statusText = 'Status: Still streaming';
                }
                
                currentUserContent += `• <#${stream.channelId}> (${stream.channelName})\n`;
                currentUserContent += `  • Started: ${startTimeStr}\n`;
                currentUserContent += `  • Ended: ${endTimeStr}\n`;
                currentUserContent += `  • Duration: ${formatDuration(stream.duration)}\n`;
                currentUserContent += `  • ${statusText}\n\n`;
                
                // Increment the stream counter for the current page
                streamsOnCurrentPage++;
            }
        }
        
        // Add the last user and embed if not already added
        if (currentEmbed && currentUserContent) {
            const user = userStreams[currentUserId];
            const incompl