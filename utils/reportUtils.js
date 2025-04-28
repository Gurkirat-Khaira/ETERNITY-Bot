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
        
        // Query streams that were active in the last hour - FIXED to use streams array
        logger.addRequestStep(requestId, 'querying-database');
        const streamActivities = await StreamActivity.find({
            guildId: guildId,
            streams: {
                $elemMatch: {
                    $or: [
                        // Streams that started in the time period
                        { startTime: { $gte: startTime, $lte: endTime } },
                        // Streams that ended in the time period
                        { endTime: { $gte: startTime, $lte: endTime } },
                        // Streams that were active through the time period (started before, ended after or still active)
                        { 
                            $and: [
                                { startTime: { $lte: startTime } },
                                { $or: [
                                    { endTime: { $gte: endTime } },
                                    { endTime: null }
                                ]}
                            ]
                        }
                    ]
                }
            }
        });
        
        logger.addRequestStep(requestId, 'processing-streams');
        // Extract relevant streams from each activity
        const streams = [];
        for (const activity of streamActivities) {
            for (const stream of activity.streams) {
                // Check if the stream was active during the time period
                if ((stream.startTime >= startTime && stream.startTime <= endTime) ||
                    (stream.endTime && stream.endTime >= startTime && stream.endTime <= endTime) ||
                    (stream.startTime <= startTime && (!stream.endTime || stream.endTime >= endTime))) {
                    streams.push({
                        userId: activity.userId,
                        username: activity.username,
                        startTime: stream.startTime,
                        endTime: stream.endTime,
                        channelId: stream.channelId,
                        channelName: stream.channelName,
                        interrupted: stream.interrupted || false
                    });
                }
            }
        }
        
        // Sort streams by start time (newest first)
        streams.sort((a, b) => b.startTime - a.startTime);
        
        logger.debug(`Found ${streams.length} streams for hourly report`, { requestId, streamCount: streams.length });
        
        // Create base embed that all pages will extend
        const baseEmbed = new EmbedBuilder()
            .setTitle('📊 Hourly Stream Report')
            .setColor('#0099ff')
            .setDescription(`Stream activity in the last hour (${startTime.toLocaleString()} - ${endTime.toLocaleString()})`)
            .setTimestamp();
        
        // If no streams, return a single embed
        if (streams.length === 0) {
            baseEmbed.addFields([{ name: 'No Streams', value: 'No streaming activity in the past hour.' }]);
            logger.endRequest(requestId, true, { pages: 1 });
            return [baseEmbed];
        }
        
        // Group streams by user
        const userStreams = {};
        let totalStreamTime = 0;
        let totalStreamCount = 0;
        
        streams.forEach(stream => {
            const userId = stream.userId;
            if (!userStreams[userId]) {
                userStreams[userId] = {
                    username: stream.username,
                    streamCount: 0,
                    totalDuration: 0,
                    streams: []
                };
            }
            
            // Calculate duration within the report period
            const streamStart = stream.startTime > startTime ? stream.startTime : startTime;
            const streamEnd = stream.endTime && stream.endTime < endTime ? stream.endTime : endTime;
            
            // Calculate duration in milliseconds, then convert to seconds for formatDuration
            const durationMs = Math.max(0, (streamEnd - streamStart));
            const durationSec = Math.round(durationMs / 1000); // Round to nearest second
            
            userStreams[userId].streamCount++;
            userStreams[userId].totalDuration += durationSec;
            userStreams[userId].streams.push({
                channelId: stream.channelId,
                channelName: stream.channelName,
                startTime: stream.startTime,
                endTime: stream.endTime,
                duration: durationSec,
                interrupted: stream.interrupted
            });
            
            totalStreamTime += durationSec;
            totalStreamCount++;
        });
        
        // Create summary field that will be on all pages
        const summaryField = { 
            name: 'Summary', 
            value: `**Total Streams:** ${totalStreamCount}\n` + 
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
                totalDuration: user.totalDuration
            });
            
            // Add each stream from this user
            user.streams.forEach(stream => {
                allStreamEntries.push({
                    type: 'stream',
                    stream: stream
                });
            });
        });
        
        // Calculate number of pages needed
        const pageCount = Math.ceil(totalStreamCount / MAX_STREAMS_PER_PAGE);
        
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
                    currentEmbed.addFields([{ 
                        name: `${userStreams[currentUserId].username} (${userStreams[currentUserId].streamCount} stream${userStreams[currentUserId].streamCount !== 1 ? 's' : ''})`,
                        value: `**Total Time:** ${formatDuration(userStreams[currentUserId].totalDuration)}\n${currentUserContent}`
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
                if (pageCount > 1) {
                    currentEmbed.setTitle(`📊 Hourly Stream Report (Page ${currentPage+1}/${pageCount})`);
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
                    currentEmbed.addFields([{ 
                        name: `${userStreams[currentUserId].username} (${userStreams[currentUserId].streamCount} stream${userStreams[currentUserId].streamCount !== 1 ? 's' : ''})`,
                        value: `**Total Time:** ${formatDuration(userStreams[currentUserId].totalDuration)}\n${currentUserContent}`
                    }]);
                    
                    currentUserContent = '';
                }
                
                // Set the current user
                currentUserId = Object.keys(userStreams).find(id => userStreams[id].username === entry.username);
                
            } else if (entry.type === 'stream') {
                // Add stream details to the current user's content
                const stream = entry.stream;
                const status = stream.endTime ? 'Ended' : 'Still Live';
                const interruptedText = stream.interrupted ? ' (Interrupted)' : '';
                
                // Format timestamps for readability
                const startTimeStr = stream.startTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
                const endTimeStr = stream.endTime ? stream.endTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                }) : 'Now';
                
                currentUserContent += `• <#${stream.channelId}> (${stream.channelName})\n`;
                currentUserContent += `  • Started: ${startTimeStr}\n`;
                currentUserContent += `  • ${stream.endTime ? 'Ended: ' + endTimeStr : 'Still streaming'}\n`;
                currentUserContent += `  • Duration: ${formatDuration(stream.duration)}${interruptedText}\n\n`;
                
                // Increment the stream counter for the current page
                streamsOnCurrentPage++;
            }
        }
        
        // Add the last user and embed if not already added
        if (currentEmbed && currentUserContent) {
            currentEmbed.addFields([{ 
                name: `${userStreams[currentUserId].username} (${userStreams[currentUserId].streamCount} stream${userStreams[currentUserId].streamCount !== 1 ? 's' : ''})`,
                value: `**Total Time:** ${formatDuration(userStreams[currentUserId].totalDuration)}\n${currentUserContent}`
            }]);
            
            embeds.push(currentEmbed);
        }
        
        logger.endRequest(requestId, true, { streams: totalStreamCount, users: Object.keys(userStreams).length, pages: embeds.length });
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
        
        // Get start of current day in the guild's timezone
        const now = new Date();
        const startTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        startTime.setHours(0, 0, 0, 0);
        
        // Get current time in the guild's timezone for the end time
        const endTime = new Date();
        
        // Debug logging
        logger.debug(`Generating daily report for period: ${startTime.toISOString()} to ${endTime.toISOString()} in timezone ${timezone}`, { requestId });
        
        // Query streams that were active in the current day
        logger.addRequestStep(requestId, 'querying-database');
        const streamActivities = await StreamActivity.find({
            guildId: guildId,
            streams: {
                $elemMatch: {
                    $or: [
                        // Streams that started in the time period
                        { startTime: { $gte: startTime, $lte: endTime } },
                        // Streams that ended in the time period
                        { endTime: { $gte: startTime, $lte: endTime } },
                        // Streams that were active through the time period (started before, ended after or still active)
                        { 
                            $and: [
                                { startTime: { $lte: startTime } },
                                { $or: [
                                    { endTime: { $gte: endTime } },
                                    { endTime: null }
                                ]}
                            ]
                        }
                    ]
                }
            }
        });
        
        logger.addRequestStep(requestId, 'processing-streams');
        // Extract relevant streams from each activity
        const streams = [];
        for (const activity of streamActivities) {
            for (const stream of activity.streams) {
                // Check if the stream was active during the time period
                if ((stream.startTime >= startTime && stream.startTime <= endTime) ||
                    (stream.endTime && stream.endTime >= startTime && stream.endTime <= endTime) ||
                    (stream.startTime <= startTime && (!stream.endTime || stream.endTime >= endTime))) {
                    streams.push({
                        userId: activity.userId,
                        username: activity.username,
                        startTime: stream.startTime,
                        endTime: stream.endTime,
                        channelId: stream.channelId,
                        channelName: stream.channelName,
                        interrupted: stream.interrupted || false
                    });
                }
            }
        }
        
        // Sort streams by start time (newest first)
        streams.sort((a, b) => b.startTime - a.startTime);
        
        logger.debug(`Found ${streams.length} streams for daily report`, { requestId, streamCount: streams.length });
        
        const dateStr = startTime.toLocaleDateString('en-US', { timeZone: timezone });
        
        // Create base embed that all pages will extend
        const baseEmbed = new EmbedBuilder()
            .setTitle('📈 Daily Stream Report')
            .setColor('#00cc99')
            .setDescription(`Stream activity for ${dateStr} (${timezone} timezone)`)
            .setTimestamp();
        
        // If no streams, return a single embed
        if (streams.length === 0) {
            baseEmbed.addFields([{ name: 'No Streams', value: `No streaming activity on ${dateStr}.` }]);
            logger.endRequest(requestId, true, { pages: 1 });
            return [baseEmbed];
        }
        
        // Group streams by user
        const userStreams = {};
        let totalStreamTime = 0;
        let totalStreamCount = 0;
        
        streams.forEach(stream => {
            const userId = stream.userId;
            if (!userStreams[userId]) {
                userStreams[userId] = {
                    username: stream.username,
                    streamCount: 0,
                    totalDuration: 0,
                    streams: []
                };
            }
            
            // Calculate duration within the report period
            const streamStart = stream.startTime > startTime ? stream.startTime : startTime;
            const streamEnd = stream.endTime && stream.endTime < endTime ? stream.endTime : endTime;
            
            // Calculate duration in milliseconds, then convert to seconds for formatDuration
            const durationMs = Math.max(0, (streamEnd - streamStart));
            const durationSec = Math.round(durationMs / 1000); // Round to nearest second
            
            userStreams[userId].streamCount++;
            userStreams[userId].totalDuration += durationSec;
            userStreams[userId].streams.push({
                channelId: stream.channelId,
                channelName: stream.channelName,
                startTime: stream.startTime,
                endTime: stream.endTime,
                duration: durationSec,
                interrupted: stream.interrupted
            });
            
            totalStreamTime += durationSec;
            totalStreamCount++;
        });
        
        // Create summary field that will be on all pages
        const summaryField = { 
            name: 'Summary', 
            value: `**Total Streams:** ${totalStreamCount}\n` + 
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
                totalDuration: user.totalDuration
            });
            
            // Add each stream from this user
            user.streams.forEach(stream => {
                allStreamEntries.push({
                    type: 'stream',
                    stream: stream
                });
            });
        });
        
        // Calculate number of pages needed
        const pageCount = Math.ceil(totalStreamCount / MAX_STREAMS_PER_PAGE);
        
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
                    currentEmbed.addFields([{ 
                        name: `${userStreams[currentUserId].username} (${userStreams[currentUserId].streamCount} stream${userStreams[currentUserId].streamCount !== 1 ? 's' : ''})`,
                        value: `**Total Time:** ${formatDuration(userStreams[currentUserId].totalDuration)}\n${currentUserContent}`
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
                if (pageCount > 1) {
                    currentEmbed.setTitle(`📈 Daily Stream Report (Page ${currentPage+1}/${pageCount})`);
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
                    currentEmbed.addFields([{ 
                        name: `${userStreams[currentUserId].username} (${userStreams[currentUserId].streamCount} stream${userStreams[currentUserId].streamCount !== 1 ? 's' : ''})`,
                        value: `**Total Time:** ${formatDuration(userStreams[currentUserId].totalDuration)}\n${currentUserContent}`
                    }]);
                    
                    currentUserContent = '';
                }
                
                // Set the current user
                currentUserId = sortedUserIds.find(id => userStreams[id].username === entry.username);
                
            } else if (entry.type === 'stream') {
                // Add stream details to the current user's content
                const stream = entry.stream;
                const status = stream.endTime ? 'Ended' : 'Still Live';
                const interruptedText = stream.interrupted ? ' (Interrupted)' : '';
                
                // Format timestamps for readability
                const startTimeStr = stream.startTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
                const endTimeStr = stream.endTime ? stream.endTime.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                }) : 'Now';
                
                currentUserContent += `• <#${stream.channelId}> (${stream.channelName})\n`;
                currentUserContent += `  • Started: ${startTimeStr}\n`;
                currentUserContent += `  • ${stream.endTime ? 'Ended: ' + endTimeStr : 'Still streaming'}\n`;
                currentUserContent += `  • Duration: ${formatDuration(stream.duration)}${interruptedText}\n\n`;
                
                // Increment the stream counter for the current page
                streamsOnCurrentPage++;
            }
        }
        
        // Add the last user and embed if not already added
        if (currentEmbed && currentUserContent) {
            currentEmbed.addFields([{ 
                name: `${userStreams[currentUserId].username} (${userStreams[currentUserId].streamCount} stream${userStreams[currentUserId].streamCount !== 1 ? 's' : ''})`,
                value: `**Total Time:** ${formatDuration(userStreams[currentUserId].totalDuration)}\n${currentUserContent}`
            }]);
            
            embeds.push(currentEmbed);
        }
        
        logger.endRequest(requestId, true, { streams: totalStreamCount, users: Object.keys(userStreams).length, pages: embeds.length });
        return embeds;
    } catch (error) {
        logger.error('Error generating daily report:', { error: error.message, stack: error.stack });
        
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
 * Send a report to a channel with pagination support
 * @param {Object} interaction - Discord interaction object
 * @param {Array<EmbedBuilder>} reportEmbeds - Array of report embeds
 * @param {boolean} ephemeral - Whether the message should be ephemeral
 */
async function sendReportWithPagination(interaction, reportEmbeds, ephemeral = false) {
    await createPaginatedEmbed(interaction, reportEmbeds, ephemeral);
}

module.exports = {
    generateHourlyReport,
    generateDailyReport,
    sendReportWithPagination
};