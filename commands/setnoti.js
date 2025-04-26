const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setNotificationChannel } = require('../utils/configUtils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setnoti')
    .setDescription('Set the channel for stream notifications')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel to send stream notifications to')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  // Add command aliases for text commands
  aliases: ['setnc', 'notifychannel'],
  
  // Slash command execution
  async execute(interaction) {
    // Check if user has admin permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'You need Administrator permissions to use this command.',
        ephemeral: true
      });
    }
    
    const channel = interaction.options.getChannel('channel');
    
    // Make sure we can send messages to this channel
    try {
      if (!channel.permissionsFor(interaction.guild.members.me).has('SendMessages')) {
        return interaction.reply({
          content: `I don't have permission to send messages in ${channel}. Please make sure I have the proper permissions.`,
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
    
    const success = await setNotificationChannel(interaction.guild.id, channel.id);
    
    if (success) {
      return interaction.reply({
        content: `Stream notifications will now be sent to ${channel}`,
        ephemeral: false
      });
    } else {
      return interaction.reply({
        content: 'There was an error setting the notification channel. Please try again later.',
        ephemeral: true
      });
    }
  },
  
  // Text command execution
  async executeText(message, args, prefix) {
    // Check if user has admin permissions
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('You need Administrator permissions to use this command.');
    }
    
    const channelMention = args[0];
    if (!channelMention || !channelMention.startsWith('<#') || !channelMention.endsWith('>')) {
      return message.reply(`Please provide a valid channel. Usage: ${prefix}setnoti #channel-name`);
    }
    
    // Extract channel ID from mention
    const channelId = channelMention.slice(2, -1);
    const channel = message.guild.channels.cache.get(channelId);
    
    if (!channel || channel.type !== ChannelType.GuildText) {
      return message.reply('Please provide a valid text channel.');
    }
    
    // Make sure we can send messages to this channel
    try {
      if (!channel.permissionsFor(message.guild.members.me).has('SendMessages')) {
        return message.reply(`I don't have permission to send messages in ${channel}. Please make sure I have the proper permissions.`);
      }
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
    
    const success = await setNotificationChannel(message.guild.id, channel.id);
    
    if (success) {
      return message.reply(`Stream notifications will now be sent to ${channel}`);
    } else {
      return message.reply('There was an error setting the notification channel. Please try again later.');
    }
  }
}; 