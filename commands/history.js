const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserStreamHistory, formatTime } = require('../utils/streamUtils');
const { createPaginatedEmbed } = require('../utils/paginationUtils');
const logger = require('../utils/logger');

const STREAMS_PER_PAGE = 5; // Number of streams to display per page

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View your streaming history')
    .addUserOption(option => 
      option.setName('user')
        .setDescription('The user to check history for')
        .setRequired(false))
    .addIntegerOption(option =>
      option.setName('limit')
        .setDescription('Number of streams to show (1-25)')
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)),
  
  // Add command aliases for text commands
  aliases: ['h', 'streamhistory'],
  
  // Default cooldown
  cooldown: 5,
  
  // Help information
  help: {
    category: 'Stream Tracking',
    description: 'View stream history for a user, showing details of past streams',
    usage: 'history [user]',
    examples: ['history', 'history @User']
  },
  
  /**
   * Execute for slash command
   * @param {Interaction} interaction - Discord interaction object
   */
  async execute(interaction) {
    // Defer reply to avoid timeout during data fetching
    await interaction.deferReply();
    
    // Target user is either the mentioned user or the command user
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const limit = interaction.options.getInteger('limit') || 0;
    
    try {
      // Get the requested user's stream history with optional limit
      await displayStreamHistory(interaction, targetUser, interaction.guildId, limit);
    } catch (error) {
      logger.error('Error executing history command:', { 
        error: error.message, 
        stack: error.stack,
        userId: interaction.user.id,
        targetUserId: targetUser.id
      });
      return interaction.editReply('There was an error retrieving the stream history. Please try again later.');
    }
  },
  
  /**
   * Execute for message command (for backward compatibility)
   * @param {Message} message - Discord message object
   * @param {Array} args - Command arguments
   * @param {String} prefix - Command prefix
   */
  async executeText(message, args, prefix) {
    // Determine the target user (command author or mentioned user)
    let targetUser = message.author;
    if (args.length > 0 && message.mentions.users.size > 0) {
      targetUser = message.mentions.users.first();
    }
    
    try {
      const loadingMsg = await message.reply('Fetching stream history...');
      
      // Create a wrapper around the message to mimic interaction API
      const msgWrapper = {
        editReply: async (options) => loadingMsg.edit(options),
        author: message.author,
        replied: true
      };
      
      await displayStreamHistory(msgWrapper, targetUser, message.guild.id);
    } catch (error) {
      logger.error('Error executing history text command:', { 
        error: error.message, 
        stack: error.stack,
        userId: message.author.id,
        targetUserId: targetUser.id
      });
      return message.reply('There was an error retrieving the stream history. Please try again later.');
    }
  }
};

/**
 * Helper function to display stream history
 * @param {Object} interaction - Discord interaction or message wrapper
 * @param {User} targetUser - Discord user to show history for
 * @param {String} guildId - Discord guild ID
 * @param {Number} limit - Optional limit on number of streams to display
 */
async function displayStreamHistory(interaction, targetUser, guildId, limit = 0) {
  // Fetch the stream history
  const streams = await getUserStreamHistory(targetUser.id, guildId, limit);
  
  // Handle case when user has no stream history
  if (!streams || streams.length === 0) {
    return interaction.editReply(`${targetUser.username} hasn't streamed yet.`);
  }
  
  // Create embeds for pagination
  const pages = [];
  const totalPages = Math.ceil(streams.length / STREAMS_PER_PAGE);
  
  // Generate a page for each set of streams
  for (let i = 0; i < totalPages; i++) {
    const startIdx = i * STREAMS_PER_PAGE;
    const pageStreams = streams.slice(startIdx, startIdx + STREAMS_PER_PAGE);
    
    // Create embed for this page
    const embed = new EmbedBuilder()
      .setColor('#00B0F4')
      .setTitle(`Stream History for ${targetUser.username}`)
      .setThumbnail(targetUser.displayAvatarURL())
      .setFooter({ text: `Page ${i+1}/${totalPages} • Total Streams: ${streams.length}` });
    
    // Add each stream to the embed
    for (const stream of pageStreams) {
      const startTime = new Date(stream.startTime);
      const streamDate = startTime.toLocaleDateString();
      const startTimeStr = startTime.toLocaleTimeString();
      
      // Different display for interrupted vs normal streams
      if (stream.interrupted) {
        // For interrupted streams, show simplified information
        embed.addFields({
          name: `Stream on ${streamDate}`,
          value: `
            **Channel:** ${stream.channelName}
            **Started:** ${startTimeStr}
            **Status:** Stream was interrupted
          `,
          inline: false
        });
      } else {
        // For normal streams, show complete information
        const endTime = new Date(stream.endTime);
        const duration = formatTime(stream.duration || 0);
        const endTimeStr = endTime.toLocaleTimeString();
        
        embed.addFields({
          name: `Stream on ${streamDate}`,
          value: `
            **Channel:** ${stream.channelName}
            **Started:** ${startTimeStr}
            **Ended:** ${endTimeStr}
            **Duration:** ${duration}
          `,
          inline: false
        });
      }
    }
    
    pages.push(embed);
  }
  
  // Display the paginated embeds
  await createPaginatedEmbed(interaction, pages);
} 