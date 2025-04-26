const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserStreamStats, formatTime } = require('../utils/streamUtils');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View streaming statistics')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('The user to check stats for')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('period')
        .setDescription('The time period for stream stats')
        .setRequired(false)
        .addChoices(
          { name: 'Daily', value: 'day' },
          { name: 'Weekly', value: 'week' },
          { name: 'Monthly', value: 'month' },
          { name: 'All Time', value: 'all' }
        )),
  
  // Add command aliases for text commands
  aliases: ['s', 'streamstats'],
  
  async execute(interaction) {
    await interaction.deferReply();
    
    // Start request tracking
    const requestId = logger.startRequest('command:stats', {
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      isSlashCommand: true
    });
    
    try {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      
      if (!targetUser) {
        logger.warn('Target user not found', { requestId });
        return interaction.editReply({
          content: 'Could not find the specified user.',
          ephemeral: true
        });
      }
      
      if (!interaction.guild) {
        logger.warn('Command used outside of guild', { requestId });
        return interaction.editReply({
          content: 'This command can only be used in a server.',
          ephemeral: true
        });
      }
      
      // Log the request details
      logger.addRequestStep(requestId, 'fetching-stats', {
        targetUserId: targetUser.id,
        guildId: interaction.guild.id
      });
      
      // Stream stats
      const period = interaction.options.getString('period') || 'all';
      
      // Validate period
      if (!['day', 'week', 'month', 'all'].includes(period)) {
        logger.warn(`Invalid period: ${period}`, { requestId });
        return interaction.editReply({
          content: 'Invalid time period. Please use one of: day, week, month, all.',
          ephemeral: true
        });
      }
      
      logger.addRequestStep(requestId, 'fetching-stream-stats', { period });
      const stats = await getUserStreamStats(targetUser.id, interaction.guild.id, period);
      
      // Check if stats were retrieved successfully
      if (!stats) {
        logger.error('Failed to get stream stats', { requestId, targetUserId: targetUser.id, period });
        return interaction.editReply({
          content: 'Could not retrieve stream stats at this time. Please try again later.',
          ephemeral: true
        });
      }
      
      const periodLabels = {
        day: "Today's",
        week: "This Week's",
        month: "This Month's",
        all: "All-time"
      };
      
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`${periodLabels[period]} Stream Stats for ${targetUser.username || targetUser.globalName || targetUser.displayName}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: 'Total Stream Time', value: formatTime(stats.totalStreamTime || 0), inline: true },
          { name: 'Total Streams', value: `${stats.totalStreams || 0}`, inline: true }
        );
      
      // Add period-specific stats if available
      if (stats.periodStats && period !== 'all') {
        const periodStats = stats.periodStats;
        embed.addFields(
          { name: `${periodLabels[period]} Stream Time`, value: formatTime(periodStats.totalMinutes || 0), inline: true },
          { name: `${periodLabels[period]} Streams`, value: `${periodStats.streamCount || 0}`, inline: true }
        );
      }
      
      if (stats.lastUpdated) {
        embed.setFooter({ text: `Last updated: ${new Date(stats.lastUpdated).toLocaleString()}` });
      }
      
      await interaction.editReply({ embeds: [embed] });
      logger.endRequest(requestId, true, { statsType: 'stream', period });
    } catch (error) {
      logger.error('Error executing stats command', { 
        requestId, 
        errorMessage: error.message,
        stack: error.stack
      });
      
      // Provide a more specific error message based on the error type
      let errorMessage = 'There was an error fetching the streaming stats.';
      
      if (error.name === 'MongooseError' || error.name === 'MongoError') {
        errorMessage = 'There was a database error. Please try again later.';
      } else if (error.message.includes('permission')) {
        errorMessage = 'I don\'t have permission to complete this action.';
      } else if (error.message.includes('rate limit')) {
        errorMessage = 'We\'re being rate limited. Please try again in a moment.';
      }
      
      await interaction.editReply({
        content: `${errorMessage} If this issue persists, please contact the server administrator.`,
        ephemeral: true
      });
      
      logger.endRequest(requestId, false, { errorType: error.name });
    }
  },
  
  // Text command execution
  async executeText(message, args, prefix) {
    // Start request tracking
    const requestId = logger.startRequest('command:stats:text', {
      userId: message.author.id,
      guildId: message.guild?.id,
      isSlashCommand: false
    });
    
    try {
      // Parse arguments
      let targetUser = message.author;
      let period = 'all';
      
      // Check for user mention as first arg
      if (args.length > 0 && message.mentions.users.size > 0) {
        targetUser = message.mentions.users.first();
        args.shift();
      }
      
      // Check for period as next arg
      if (args.length > 0 && ['day', 'week', 'month', 'all'].includes(args[0].toLowerCase())) {
        period = args[0].toLowerCase();
      }
      
      if (!message.guild) {
        logger.warn('Command used outside of guild', { requestId });
        await message.reply('This command can only be used in a server.');
        return logger.endRequest(requestId, false, { reason: 'not-in-guild' });
      }
      
      // Log what we're doing
      logger.addRequestStep(requestId, 'fetching-stream-stats', {
        targetUserId: targetUser.id,
        period
      });
      
      // Get stream stats
      const stats = await getUserStreamStats(targetUser.id, message.guild.id, period);
      
      if (!stats) {
        logger.error('Failed to get stream stats', { 
          requestId, 
          targetUserId: targetUser.id,
          period
        });
        await message.reply('Could not retrieve stream stats at this time. Please try again later.');
        return logger.endRequest(requestId, false, { reason: 'stats-retrieval-failed' });
      }
      
      const periodLabels = {
        day: "Today's",
        week: "This Week's",
        month: "This Month's",
        all: "All-time"
      };
      
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`${periodLabels[period]} Stream Stats for ${targetUser.username || targetUser.globalName || targetUser.displayName}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: 'Total Stream Time', value: formatTime(stats.totalStreamTime || 0), inline: true },
          { name: 'Total Streams', value: `${stats.totalStreams || 0}`, inline: true }
        );
      
      // Add period-specific stats if available
      if (stats.periodStats && period !== 'all') {
        const periodStats = stats.periodStats;
        embed.addFields(
          { name: `${periodLabels[period]} Stream Time`, value: formatTime(periodStats.totalMinutes || 0), inline: true },
          { name: `${periodLabels[period]} Streams`, value: `${periodStats.streamCount || 0}`, inline: true }
        );
      }
      
      if (stats.lastUpdated) {
        embed.setFooter({ text: `Last updated: ${new Date(stats.lastUpdated).toLocaleString()}` });
      }
      
      await message.reply({ embeds: [embed] });
      logger.endRequest(requestId, true, { statsType: 'stream', period });
    } catch (error) {
      logger.error('Error executing stats text command', {
        requestId,
        errorMessage: error.message,
        stack: error.stack
      });
      
      await message.reply('There was an error fetching the stream stats. Please try again later.');
      logger.endRequest(requestId, false, { errorType: error.name });
    }
  }
};
