const { Client, GatewayIntentBits, Partials, Events, Collection, EmbedBuilder, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const cron = require('node-cron');
require('dotenv').config();

// Import database connection
const connectDB = require('./config/database');

// Import utilities
const {
  startStreamSession,
  endStreamSession,
  getActiveStream,
  saveStreamNotificationId,
  getStreamNotificationId,
  getAllActiveStreams,
  markStreamAsInterrupted
} = require('./utils/streamUtils');

const {
  getGuildPrefix,
  getOrCreateGuildConfig,
  getNotificationChannel,
  isStreamTrackingEnabled
} = require('./utils/configUtils');

// Import report utility
const { generateHourlyReport, generateDailyReport } = require('./utils/reportUtils');

// Import rate limiting utility
const { checkCommandLimit, getDefaultCooldown } = require('./utils/rateLimit');

// Import logger if it exists, otherwise create basic logger functions
let logger;
try {
  logger = require('./utils/logger');
} catch (error) {
  // Fallback basic logger if the enhanced logger isn't available yet
  logger = {
    error: (msg, meta) => console.error(msg, meta),
    warn: (msg, meta) => console.warn(msg, meta),
    info: (msg, meta) => console.log(msg, meta),
    debug: (msg, meta) => {},
    startRequest: () => null,
    addRequestStep: () => {},
    endRequest: () => {}
  };
}

/**
 * Create a new Discord client instance with required intents and partials
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// Collection for commands
client.commands = new Collection();

// Connect to MongoDB with better feedback
connectDB()
  .then(() => {
    console.log('✅ MongoDB connection established successfully');
  })
  .catch(err => {
    console.error('❌ Failed to connect to database on startup', err.message);
    logger.error('Failed to connect to database on startup', { error: err.message });
  });

/**
 * Load command files from the commands directory
 */
function loadCommands() {
  try {
    const commandsPath = path.join(__dirname, 'commands');
    if (!fs.existsSync(commandsPath)) {
      console.warn('⚠️ Commands directory not found');
      logger.warn('Commands directory not found');
      return;
    }
    
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    let loadedCount = 0;
    
    for (const file of commandFiles) {
      try {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
          loadedCount++;
          logger.debug(`Loaded command: ${command.data.name}`);
        } else {
          logger.warn(`Command at ${filePath} is missing required "data" or "execute" property`);
        }
      } catch (error) {
        console.error(`Failed to load command from file ${file}: ${error.message}`);
        logger.error(`Failed to load command from file ${file}`, { error: error.message });
      }
    }
    
    // Always show how many commands were loaded
    console.log(`📝 Loaded ${loadedCount} commands`);
    logger.info(`Loaded ${loadedCount} commands`);
  } catch (error) {
    console.error(`❌ Error loading commands: ${error.message}`);
    logger.error('Error loading commands', { error: error.message, stack: error.stack });
  }
}

/**
 * Send stream notifications for user streaming activity
 * 
 * @param {Guild} guild - Discord guild object
 * @param {User} user - Discord user object
 * @param {String} channelId - Voice channel ID
 * @param {String} channelName - Voice channel name
 * @param {Boolean} isStarting - Whether stream is starting or ending
 * @param {Number} duration - Stream duration in minutes (for ended streams)
 * @param {Boolean} interrupted - Whether the stream was interrupted
 */
async function sendStreamNotification(guild, user, channelId, channelName, isStarting, duration = null, interrupted = false) {
  const requestId = logger.startRequest('notification:stream', {
    guildId: guild.id,
    userId: user.id,
    isStarting,
    interrupted
  });
  
  try {
    // Check if notifications are enabled and channel is configured
    const trackingEnabled = await isStreamTrackingEnabled(guild.id);
    if (!trackingEnabled) {
      logger.debug('Stream tracking disabled for guild', { guildId: guild.id, requestId });
      return logger.endRequest(requestId, true, { reason: 'tracking-disabled' });
    }
    
    const notificationChannelId = await getNotificationChannel(guild.id);
    if (!notificationChannelId) {
      logger.debug('No notification channel configured for guild', { guildId: guild.id, requestId });
      return logger.endRequest(requestId, true, { reason: 'no-channel' });
    }
    
    logger.addRequestStep(requestId, 'getting-channel', { channelId: notificationChannelId });
    const notificationChannel = guild.channels.cache.get(notificationChannelId);
    if (!notificationChannel) {
      logger.warn('Configured notification channel not found', { 
        guildId: guild.id, 
        channelId: notificationChannelId,
        requestId
      });
      return logger.endRequest(requestId, false, { reason: 'channel-not-found' });
    }
    
    logger.addRequestStep(requestId, 'creating-embed', { 
      username: user.username, 
      channel: channelName,
      channelId: channelId,
      duration: duration,
      interrupted: interrupted
    });
    
    // Create appropriate embed based on stream status
    const embed = new EmbedBuilder()
      .setColor(isStarting ? '#00ff00' : (interrupted ? '#FFA500' : '#ff0000'))
      .setTitle(isStarting ? '🎬 Stream Started' : '🎬 Stream Ended')
      .setAuthor({
        name: user.username,
        iconURL: user.displayAvatarURL()
      })
      .addFields(
        { name: 'User', value: `<@${user.id}>`, inline: true },
        { name: 'Channel', value: channelId ? `<#${channelId}>` : 'Unknown channel', inline: true }
      )
      .setTimestamp();
    
    // Add duration for ended streams that weren't interrupted
    if (!isStarting && duration && !interrupted) {
      embed.addFields(
        { name: 'Duration', value: `${duration} minutes`, inline: true }
      );
    }
    
    // Add interrupted status if applicable
    if (!isStarting && interrupted) {
      embed.addFields(
        { name: 'Status', value: 'Stream was interrupted', inline: true }
      );
    }
    
    logger.addRequestStep(requestId, 'sending-notification');
    
    if (isStarting) {
      // For stream start, send a new message
      const sentMessage = await notificationChannel.send({ embeds: [embed] });
      
      // Save the message ID for later reference
      await saveStreamNotificationId(user.id, guild.id, sentMessage.id, notificationChannel.id);
      logger.debug('Saved start notification message ID', { 
        messageId: sentMessage.id, 
        channelId: notificationChannel.id,
        requestId
      });
    } else {
      // For stream end, try to get the start message and reply to it
      const notification = await getStreamNotificationId(user.id, guild.id);
      
      if (notification && notification.channelId === notificationChannel.id) {
        try {
          // Try to fetch the original message
          const originalMessage = await notificationChannel.messages.fetch(notification.messageId);
          
          // Reply to the original message
          await originalMessage.reply({ embeds: [embed] });
          logger.debug('Replied to start notification message', { 
            originalMessageId: notification.messageId,
            requestId
          });
        } catch (fetchError) {
          logger.warn('Could not fetch original notification message, sending new message', { 
            error: fetchError.message,
            requestId
          });
          await notificationChannel.send({ embeds: [embed] });
        }
      } else {
        // If we can't find the original message, send a new one
        await notificationChannel.send({ embeds: [embed] });
      }
    }
    
    logger.endRequest(requestId, true);
  } catch (error) {
    logger.error('Error sending stream notification', { 
      error: error.message,
      stack: error.stack,
      guildId: guild.id,
      userId: user.id,
      requestId
    });
    logger.endRequest(requestId, false, { error: error.message });
  }
}

/**
 * Check for active streams from previous session and handle appropriately
 */
async function checkPreviousSessionStreams() {
  try {
    const activeStreams = await getAllActiveStreams();
    if (activeStreams.length === 0) {
      return;
    }
    
    logger.info(`Found ${activeStreams.length} active streams from previous session`);
    console.log(`Found ${activeStreams.length} active streams from previous session`);
    
    // Process each active stream
    for (const stream of activeStreams) {
      const guild = client.guilds.cache.get(stream.guildId);
      if (!guild) {
        // Guild not found, mark as interrupted
        logger.info(`Guild ${stream.guildName} not found for user ${stream.username}, marking stream as interrupted`, {
          userId: stream.userId,
          guildId: stream.guildId
        });
        await markStreamAsInterrupted(stream.userId, stream.guildId);
        continue;
      }
      
      // Get the user
      const user = await client.users.fetch(stream.userId).catch(() => null);
      if (!user) {
        logger.info(`User ${stream.username} not found, marking stream as interrupted`, {
          userId: stream.userId,
          guildId: stream.guildId
        });
        
        await markStreamAsInterrupted(stream.userId, stream.guildId);
        continue;
      }
      
      // Check if the user is in a voice channel and currently streaming
      const member = await guild.members.fetch(stream.userId).catch(() => null);
      const isCurrentlyStreaming = member && 
                                 member.voice.channelId && 
                                 member.voice.streaming && 
                                 member.voice.channelId === stream.channelId;
      
      if (!isCurrentlyStreaming) {
        logger.info(`User ${stream.username} is not currently streaming in ${stream.channelName}, marking as interrupted`, {
          userId: stream.userId,
          guildId: stream.guildId,
          startTime: stream.startTime
        });
        
        const result = await markStreamAsInterrupted(stream.userId, stream.guildId);
        
        // Send notification about the interrupted stream if we have the result
        if (result && result.sessionDetails) {
          await sendStreamNotification(
            guild,
            user,
            stream.channelId,
            stream.channelName,
            false, // isStarting = false (stream ended)
            result.sessionDetails.duration,
            true // interrupted = true
          );
        }
      } else {
        logger.info(`User ${stream.username} is still streaming in ${stream.channelName}, continuing to track`, {
          userId: stream.userId,
          guildId: stream.guildId,
          channelId: stream.channelId
        });
        // User is still streaming in the same channel, no action needed
      }
    }
    
    logger.info('Completed recovery of previous session streams');
  } catch (error) {
    logger.error('Error checking for active streams from previous session', {
      error: error.message,
      stack: error.stack
    });
  }
}

// When the client is ready, run this code
client.once(Events.ClientReady, async () => {
  try {
    // Always show these critical startup messages in the console
    console.log('\n=========================================');
    console.log(`🚀 Bot is now ONLINE!`);
    console.log(`🤖 Logged in as: ${client.user.tag}`);
    console.log(`🌐 Active in ${client.guilds.cache.size} servers`);
    console.log('=========================================\n');
    
    // Also log to the logger for debug mode
    logger.info(`Logged in as ${client.user.tag}`);
    logger.info(`Bot is tracking streaming activity in ${client.guilds.cache.size} servers`);
    
    // Set bot activity
    client.user.setActivity('Streams', { type: ActivityType.Watching });
    
    // Load commands
    loadCommands();
    
    // Initialize guild configs for each guild
    for (const guild of client.guilds.cache.values()) {
      try {
        await getOrCreateGuildConfig(guild.id, guild.name);
        logger.info(`Initialized config for guild: ${guild.name}`);
      } catch (error) {
        logger.error(`Error initializing guild config for ${guild.name}`, { 
          error: error.message,
          guildId: guild.id 
        });
      }
    }

    // Check for any active streams from previous session and handle them
    await checkPreviousSessionStreams();
    
    // Set up scheduled reports
    setupScheduledReports();
  } catch (error) {
    // Always show critical errors in the console
    console.error(`❌ Error during startup: ${error.message}`);
    logger.error('Error during client ready event', { error: error.message, stack: error.stack });
  }
});

// Handle voice state updates
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const requestId = logger.startRequest('voice-state-update', {
    userId: newState.member?.user?.id,
    guildId: newState.guild?.id
  });
  
  try {
    // Skip bot users
    if (oldState.member?.user?.bot || newState.member?.user?.bot) {
      logger.debug('Skipping voice state update for bot user', { requestId });
      return logger.endRequest(requestId, true, { reason: 'bot-user' });
    }
    
    // Ensure we have all the data we need
    if (!newState.member || !newState.member.user) {
      logger.warn('Voice state update missing member or user data', { requestId });
      return logger.endRequest(requestId, false, { reason: 'missing-data' });
    }
    
    const userId = newState.member.user.id;
    const user = newState.member.user;
    const username = user.username || user.globalName || newState.member.displayName;
    const guildId = newState.guild.id;
    const guildName = newState.guild.name;
    
    logger.addRequestStep(requestId, 'checking-state-change', {
      wasStreaming: oldState.streaming,
      isStreaming: newState.streaming,
      oldChannelId: oldState.channelId,
      newChannelId: newState.channelId
    });
    
    // User started streaming in a voice channel
    if (!oldState.streaming && newState.streaming) {
      logger.info(`User ${username} started streaming in ${newState.channel.name}`, { 
        userId, 
        guildId,
        channelId: newState.channelId,
        requestId
      });
      
      await startStreamSession(
        userId,
        username,
        guildId,
        guildName,
        newState.channelId,
        newState.channel.name
      );
      
      await sendStreamNotification(
        newState.guild,
        user,
        newState.channelId,
        newState.channel.name,
        true
      );
    }
    
    // User stopped streaming in a voice channel
    else if (oldState.streaming && !newState.streaming) {
      logger.info(`User ${username} stopped streaming in ${oldState.channel?.name || 'unknown channel'}`, { 
        userId, 
        guildId,
        channelId: oldState.channelId,
        requestId
      });
      
      const result = await endStreamSession(userId, guildId);
      
      if (result && result.sessionDetails) {
        await sendStreamNotification(
          oldState.guild,
          user,
          oldState.channelId,
          oldState.channel?.name || 'unknown channel',
          false,
          result.sessionDetails.duration
        );
      }
    }
    
    // User left a voice channel while streaming
    else if (oldState.streaming && oldState.channelId && !newState.channelId) {
      logger.info(`User ${username} left voice channel while streaming`, { 
        userId, 
        guildId,
        channelId: oldState.channelId,
        requestId
      });
      
      const result = await endStreamSession(userId, guildId);
      
      if (result && result.sessionDetails) {
        await sendStreamNotification(
          oldState.guild,
          user,
          oldState.channelId,
          oldState.channel?.name || 'unknown channel',
          false,
          result.sessionDetails.duration
        );
      }
    }
    
    // User switched voice channels while streaming
    else if (oldState.streaming && newState.streaming && oldState.channelId !== newState.channelId) {
      logger.info(`User ${username} switched channels while streaming from ${oldState.channel?.name || 'unknown'} to ${newState.channel?.name || 'unknown'}`, { 
        userId, 
        guildId,
        oldChannelId: oldState.channelId,
        newChannelId: newState.channelId,
        requestId
      });
      
      // End the previous stream
      const result = await endStreamSession(userId, guildId);
      
      if (result && result.sessionDetails) {
        await sendStreamNotification(
          oldState.guild,
          user,
          oldState.channelId,
          oldState.channel?.name || 'unknown channel',
          false,
          result.sessionDetails.duration
        );
      }
      
      // Start a new stream
      await startStreamSession(
        userId,
        username,
        guildId,
        guildName,
        newState.channelId,
        newState.channel?.name || 'unknown channel'
      );
      
      await sendStreamNotification(
        newState.guild,
        user,
        newState.channelId,
        newState.channel?.name || 'unknown channel',
        true
      );
    }
    
    logger.endRequest(requestId, true);
  } catch (error) {
    logger.error('Error handling voice state update', { 
      error: error.message, 
      stack: error.stack,
      user: newState.member?.user?.id,
      guild: newState.guild?.id,
      requestId
    });
    logger.endRequest(requestId, false, { error: error.message });
  }
});

// Handle interaction create (slash commands)
client.on(Events.InteractionCreate, async interaction => {
  // Only process chat commands
  if (!interaction.isChatInputCommand()) return;
  
  const requestId = logger.startRequest(`command:${interaction.commandName}`, {
    userId: interaction.user.id,
    guildId: interaction.guild?.id,
    command: interaction.commandName
  });
  
  try {
    const command = client.commands.get(interaction.commandName);
    
    if (!command) {
      logger.warn(`No command matching ${interaction.commandName} was found`, { requestId });
      await interaction.reply({
        content: `Sorry, I couldn't find the command "${interaction.commandName}".`,
        ephemeral: true
      });
      return logger.endRequest(requestId, false, { reason: 'command-not-found' });
    }
    
    logger.addRequestStep(requestId, 'checking-rate-limit');
    
    // Check rate limit for this user and command
    const { isLimited, remainingTime, reason } = checkCommandLimit(
      interaction.user.id,
      interaction.commandName,
      command.cooldown || getDefaultCooldown(interaction.commandName),
      interaction.guild?.id
    );
    
    if (isLimited) {
      logger.debug(`Rate limit hit for ${interaction.commandName}`, { 
        userId: interaction.user.id,
        remainingTime,
        reason,
        requestId
      });
      
      return interaction.reply({
        content: `Please wait ${remainingTime} more second(s) before using this command again.`,
        ephemeral: true
      });
    }
    
    logger.addRequestStep(requestId, 'executing-command');
    await command.execute(interaction);
    logger.endRequest(requestId, true);
  } catch (error) {
    logger.error(`Error executing slash command ${interaction.commandName}`, { 
      error: error.message, 
      stack: error.stack,
      userId: interaction.user.id,
      guildId: interaction.guild?.id,
      requestId
    });
    
    let errorMessage;
    
    // Provide more informative error messages based on error type
    if (error.code === 50013) {
      errorMessage = 'I don\'t have the required permissions to perform this action.';
    } else if (error.code === 10008) {
      errorMessage = 'The related message was deleted or is inaccessible.';
    } else if (error.code === 50001) {
      errorMessage = 'I don\'t have access to the required channel or resource.';
    } else if (error.message.includes('rate limit')) {
      errorMessage = 'Discord is currently rate limiting this action. Please try again later.';
    } else {
      errorMessage = 'There was an error executing this command! The error has been logged.';
    }
    
    const responseOptions = { 
      content: errorMessage, 
      ephemeral: true 
    };
    
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(responseOptions);
      } else {
        await interaction.reply(responseOptions);
      }
    } catch (secondaryError) {
      logger.error('Failed to send error response to user', { 
        error: secondaryError.message,
        originalError: error.message,
        requestId
      });
    }
    
    logger.endRequest(requestId, false, { error: error.message });
  }
});

// Handle message commands
client.on(Events.MessageCreate, async message => {
  // Ignore messages from bots
  if (message.author.bot) return;
  
  // Ignore messages without guild (DMs)
  if (!message.guild) return;
  
  try {
    // Get the guild's prefix
    const prefix = await getGuildPrefix(message.guild.id);
    
    // Check if message starts with the prefix
    if (!message.content.startsWith(prefix)) return;
    
    // Parse the command and arguments
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    
    const requestId = logger.startRequest('command:text', {
      userId: message.author.id,
      guildId: message.guild.id,
      command: commandName
    });
    
    // Find the command file either by name or alias
    let command;
    for (const [name, cmd] of client.commands.entries()) {
      if (name === commandName || (cmd.aliases && cmd.aliases.includes(commandName))) {
        command = cmd;
        break;
      }
    }
    
    // If command doesn't exist or doesn't have executeText method, ignore
    if (!command || !command.executeText) {
      logger.debug(`Text command not found or missing executeText: ${commandName}`, { requestId });
      return logger.endRequest(requestId, false, { reason: 'command-not-found' });
    }
    
    logger.addRequestStep(requestId, 'checking-rate-limit');
    
    // Check rate limit for this user and command
    const { isLimited, remainingTime } = checkCommandLimit(
      message.author.id,
      command.data.name,
      command.cooldown || getDefaultCooldown(command.data.name),
      message.guild.id
    );
    
    if (isLimited) {
      logger.debug(`Rate limit hit for ${commandName}`, { 
        userId: message.author.id,
        remainingTime,
        requestId
      });
      
      return message.reply(`Please wait ${remainingTime} more second(s) before using this command again.`);
    }
    
    logger.addRequestStep(requestId, 'executing-command', { args });
    
    // Execute the command
    await command.executeText(message, args, prefix);
    logger.endRequest(requestId, true);
  } catch (error) {
    logger.error('Error handling message command', { 
      error: error.message, 
      stack: error.stack,
      content: message.content,
      author: message.author.id
    });
    
    // Provide more informative error messages based on error type
    let errorMessage = 'There was an error trying to execute that command!';
    
    if (error.code === 50013) {
      errorMessage = 'I don\'t have the required permissions to perform this action.';
    } else if (error.message.includes('rate limit')) {
      errorMessage = 'Discord is currently rate limiting this action. Please try again later.';
    } else if (error.name === 'MongooseError' || error.name === 'MongoError') {
      errorMessage = 'There was a database error. Please try again later.';
    }
    
    try {
      await message.reply(errorMessage);
    } catch (secondaryError) {
      logger.error('Failed to send error response to user', { 
        error: secondaryError.message,
        originalError: error.message
      });
    }
  }
});

// New guild joined event
client.on(Events.GuildCreate, async guild => {
  const requestId = logger.startRequest('guild:join', { guildId: guild.id });
  
  try {
    logger.info(`Bot joined a new guild: ${guild.name}`, { 
      guildId: guild.id,
      memberCount: guild.memberCount,
      requestId
    });
    
    // Create default configuration for the guild
    try {
      await getOrCreateGuildConfig(guild.id, guild.name);
      logger.info(`Created config for new guild: ${guild.name}`, { requestId });
      
      // Try to send a welcome message to the system channel if available
      const systemChannel = guild.systemChannel;
      if (systemChannel && systemChannel.permissionsFor(guild.members.me).has('SendMessages')) {
        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('Thanks for adding Stream Tracker Bot!')
          .setDescription(`
            I track streaming activity in voice channels and provide detailed stats.
            
            **Getting Started**:
            • Use \`${process.env.DEFAULT_PREFIX}setnotificationchannel #channel\` to set where stream notifications are sent
            • Use \`${process.env.DEFAULT_PREFIX}streamstats\` to view your streaming stats
            • Use \`${process.env.DEFAULT_PREFIX}streamleaderboard\` to see who streams the most
            
            You can also use slash commands for all features!
          `);
        
        await systemChannel.send({ embeds: [embed] });
        logger.info('Sent welcome message to new guild', { 
          guildId: guild.id, 
          channelId: systemChannel.id,
          requestId
        });
      }
    } catch (error) {
      logger.error(`Error setting up new guild ${guild.name}`, { 
        error: error.message,
        stack: error.stack,
        guildId: guild.id,
        requestId
      });
    }
    
    logger.endRequest(requestId, true);
  } catch (error) {
    logger.error('Error handling guild join event', { 
      error: error.message, 
      stack: error.stack,
      guildId: guild.id,
      requestId
    });
    logger.endRequest(requestId, false, { error: error.message });
  }
});

// Guild removed event
client.on(Events.GuildDelete, async guild => {
  const requestId = logger.startRequest('guild:leave', { guildId: guild.id });
  
  try {
    logger.info(`Bot was removed from guild: ${guild.name} (${guild.id})`, { requestId });
    // Note: You might want to keep data for a period of time in case this was accidental
    // Could add a cleanup job that removes data for guilds that haven't been active for X days
    
    logger.endRequest(requestId, true);
  } catch (error) {
    logger.error('Error handling guild leave event', { 
      error: error.message, 
      stack: error.stack,
      guildId: guild.id,
      requestId
    });
    logger.endRequest(requestId, false, { error: error.message });
  }
});

// Process unhandled errors
process.on('unhandledRejection', async (error) => {
  logger.error('Unhandled promise rejection:', { error: error.message, stack: error.stack });
  console.error('Unhandled promise rejection detected. Shutting down gracefully...');
  await performGracefulShutdown();
});

process.on('uncaughtException', async (error) => {
  logger.error('Uncaught exception:', { error: error.message, stack: error.stack });
  console.error('Uncaught exception detected. Shutting down gracefully...');
  await performGracefulShutdown();
});

/**
 * Perform graceful shutdown of the bot
 * Closes connections and exits the process
 */
async function performGracefulShutdown() {
  console.log('Performing graceful shutdown...');
  logger.info('Performing graceful shutdown...');
  
  try {
    // We no longer mark streams as interrupted during shutdown
    // That will happen at next startup if needed
    
    // Close the Discord client connection
    try {
      await client.destroy();
      console.log('Discord client connection closed');
      logger.info('Discord client connection closed');
    } catch (discordError) {
      console.error('Error closing Discord client:', discordError.message);
      logger.error('Error closing Discord client:', {
        error: discordError.message,
        stack: discordError.stack
      });
    }
    
    // Close database connection
    try {
      await mongoose.connection.close();
      console.log('Database connection closed');
      logger.info('Database connection closed');
    } catch (dbError) {
      console.error('Error closing database connection:', dbError.message);
      logger.error('Error closing database connection:', {
        error: dbError.message,
        stack: dbError.stack
      });
    }
    
    console.log('Graceful shutdown completed');
    logger.info('Graceful shutdown completed');
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    logger.error('Error during graceful shutdown:', {
      error: error.message,
      stack: error.stack
    });
  } finally {
    // Always exit the process
    process.exit(0);
  }
}

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT (Ctrl+C). Shutting down gracefully...');
  await performGracefulShutdown();
});

// Handle SIGTERM (normal termination signal)
process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  await performGracefulShutdown();
});

/**
 * Set up scheduled reports for all guilds
 */
function setupScheduledReports() {
  logger.info('Setting up scheduled stream reports');
  
  // Hourly report scheduler - runs at the start of every hour
  cron.schedule('0 * * * *', async () => {
    logger.info('Running hourly report task');
    await sendScheduledReports('hourly');
  });
  
  // Daily report scheduler - runs at midnight
  cron.schedule('0 0 * * *', async () => {
    logger.info('Running daily report task');
    await sendScheduledReports('daily');
  });
  
  logger.info('Scheduled report tasks set up successfully');
}

/**
 * Send scheduled reports to all guilds that have enabled them
 * @param {string} reportType - Type of report ('hourly' or 'daily')
 */
async function sendScheduledReports(reportType) {
  try {
    const GuildConfig = require('./models/GuildConfig');
    
    // Find guilds with appropriate report type enabled
    const query = { 
      notificationChannelId: { $ne: null }
    };
    
    // Add type-specific condition
    if (reportType === 'hourly') {
      query.hourlyReportEnabled = true;
    } else if (reportType === 'daily') {
      query.dailyReportEnabled = true;
    }
    
    const guilds = await GuildConfig.find(query);
    
    logger.info(`Sending ${reportType} reports to ${guilds.length} guilds`);
    
    for (const guildConfig of guilds) {
      if (reportType === 'hourly') {
        await sendHourlyReportToGuild(guildConfig);
      } else if (reportType === 'daily') {
        await sendDailyReportToGuild(guildConfig);
      }
    }
  } catch (error) {
    logger.error(`Error sending ${reportType} reports`, { error: error.message, stack: error.stack });
  }
}

/**
 * Send hourly report to a specific guild
 * @param {Object} guildConfig - Guild configuration object
 */
async function sendHourlyReportToGuild(guildConfig) {
  try {
    const guild = client.guilds.cache.get(guildConfig.guildId);
    if (!guild) {
      logger.warn(`Guild not found for hourly report: ${guildConfig.guildId}`);
      return;
    }
    
    const channel = guild.channels.cache.get(guildConfig.notificationChannelId);
    if (!channel) {
      logger.warn(`Notification channel not found for hourly report in guild ${guild.name}`);
      return;
    }
    
    logger.info(`Sending hourly report to ${guild.name}`);
    
    const reportEmbeds = await generateHourlyReport(guildConfig.guildId);
    await channel.send({ embeds: reportEmbeds });
    
    logger.info(`Hourly report sent to ${guild.name}`);
  } catch (error) {
    logger.error(`Error sending hourly report to guild ${guildConfig.guildId}`, {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Send daily report to a specific guild
 * @param {Object} guildConfig - Guild configuration object
 */
async function sendDailyReportToGuild(guildConfig) {
  try {
    const guild = client.guilds.cache.get(guildConfig.guildId);
    if (!guild) {
      logger.warn(`Guild not found for daily report: ${guildConfig.guildId}`);
      return;
    }
    
    const channel = guild.channels.cache.get(guildConfig.notificationChannelId);
    if (!channel) {
      logger.warn(`Notification channel not found for daily report in guild ${guild.name}`);
      return;
    }
    
    logger.info(`Sending daily report to ${guild.name}`);
    
    const reportEmbeds = await generateDailyReport(guildConfig.guildId);
    await channel.send({ embeds: reportEmbeds });
    
    logger.info(`Daily report sent to ${guild.name}`);
  } catch (error) {
    logger.error(`Error sending daily report to guild ${guildConfig.guildId}`, {
      error: error.message,
      stack: error.stack
    });
  }
}

// Login to Discord with your token
client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log('🔑 Successfully connected to Discord API');
    logger.info('Successfully logged in to Discord');
  })
  .catch(error => {
    // Always show login errors in the console
    console.error('❌ FAILED TO CONNECT TO DISCORD!');
    console.error(`Error: ${error.message}`);
    console.error('Please check your Discord token in the .env file');
    
    logger.error('Failed to log in to Discord', { 
      error: error.message, 
      stack: error.stack 
    });
  });
