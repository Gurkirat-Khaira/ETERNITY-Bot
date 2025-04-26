const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getServerStreamLeaderboard, formatTime } = require('../utils/streamUtils');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the stream leaderboard for the server')
    .addStringOption(option =>
      option.setName('period')
        .setDescription('Time period for the stats')
        .setRequired(false)
        .addChoices(
          { name: 'Daily', value: 'day' },
          { name: 'Weekly', value: 'week' },
          { name: 'Monthly', value: 'month' },
          { name: 'All Time', value: 'all' }
        ))
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Number of users to show (default: 10)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25)),
  
  // Add command aliases for text commands
  aliases: ['streamboard', 'streamleaderboard', 'top'],
  
  async execute(interaction) {
    await interaction.deferReply();
    
    try {
      const period = interaction.options.getString('period') || 'all';
      const limit = interaction.options.getInteger('limit') || 10;
      
      // Validate period
      if (!['day', 'week', 'month', 'all'].includes(period)) {
        return interaction.editReply({
          content: 'Invalid time period. Please use one of: day, week, month, all.',
          ephemeral: true
        });
      }
      
      const leaderboard = await getServerStreamLeaderboard(interaction.guild.id, period, limit);
      
      if (!leaderboard || leaderboard.length === 0) {
        return interaction.editReply('No streaming activity found for this server.');
      }
      
      const periodLabels = {
        day: "Today's",
        week: "This Week's",
        month: "This Month's",
        all: "All-time"
      };
      
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`${periodLabels[period]} Stream Leaderboard for ${interaction.guild.name}`)
        .setThumbnail(interaction.guild.iconURL())
        .setDescription('Users with the most streaming time in this server.');
      
      let description = '';
      
      leaderboard.forEach((user, index) => {
        description += `**${index + 1}.** <@${user.userId}> - ${formatTime(user.streamTime)} (${user.streamCount} streams)\n`;
      });
      
      embed.setDescription(description);
      embed.setFooter({ text: `Showing top ${leaderboard.length} out of ${leaderboard.length} users with streaming activity.` });
      embed.setTimestamp();
      
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing leaderboard command', { 
        error: error.message, 
        stack: error.stack,
        guildId: interaction.guild?.id
      });
      
      return interaction.editReply('There was an error getting the leaderboard. Please try again later.');
    }
  },
  
  // Text command execution
  async executeText(message, args, prefix) {
    try {
      let period = 'all';
      let limit = 10;
      
      // Parse period from arguments
      if (args.length > 0 && ['day', 'week', 'month', 'all'].includes(args[0].toLowerCase())) {
        period = args[0].toLowerCase();
      }
      
      // Parse limit from arguments
      if (args.length > 1 && !isNaN(args[1])) {
        limit = Math.min(Math.max(parseInt(args[1], 10), 1), 25);
      }
      
      const leaderboard = await getServerStreamLeaderboard(message.guild.id, period, limit);
      
      if (!leaderboard || leaderboard.length === 0) {
        return message.reply('No streaming activity found for this server.');
      }
      
      const periodLabels = {
        day: "Today's",
        week: "This Week's",
        month: "This Month's",
        all: "All-time"
      };
      
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`${periodLabels[period]} Stream Leaderboard for ${message.guild.name}`)
        .setThumbnail(message.guild.iconURL())
        .setDescription('Users with the most streaming time in this server.');
      
      let description = '';
      
      leaderboard.forEach((user, index) => {
        description += `**${index + 1}.** <@${user.userId}> - ${formatTime(user.streamTime)} (${user.streamCount} streams)\n`;
      });
      
      embed.setDescription(description);
      embed.setFooter({ text: `Showing top ${leaderboard.length} out of ${leaderboard.length} users with streaming activity.` });
      embed.setTimestamp();
      
      return message.reply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing leaderboard text command', { 
        error: error.message, 
        stack: error.stack,
        guildId: message.guild?.id
      });
      
      return message.reply('There was an error getting the leaderboard. Please try again later.');
    }
  }
};
