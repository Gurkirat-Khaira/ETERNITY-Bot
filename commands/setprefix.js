const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setGuildPrefix } = require('../utils/configUtils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setprefix')
    .setDescription('Set the custom prefix for commands in this server')
    .addStringOption(option =>
      option.setName('prefix')
        .setDescription('The new prefix to use for commands')
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  // Add command aliases for text commands
  aliases: ['prefix'],
  
  // Slash command execution
  async execute(interaction) {
    // Check if user has admin permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'You need Administrator permissions to use this command.',
        ephemeral: true
      });
    }
    
    const newPrefix = interaction.options.getString('prefix');
    
    if (!newPrefix || newPrefix.length > 5) {
      return interaction.reply({
        content: 'Please provide a valid prefix (maximum 5 characters).',
        ephemeral: true
      });
    }
    
    const success = await setGuildPrefix(interaction.guild.id, newPrefix);
    
    if (success) {
      return interaction.reply({
        content: `Server prefix has been updated to: \`${newPrefix}\``,
        ephemeral: false
      });
    } else {
      return interaction.reply({
        content: 'There was an error updating the prefix. Please try again later.',
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
    
    const newPrefix = args[0];
    
    if (!newPrefix || newPrefix.length > 5) {
      return message.reply('Please provide a valid prefix (maximum 5 characters).');
    }
    
    const success = await setGuildPrefix(message.guild.id, newPrefix);
    
    if (success) {
      return message.reply(`Server prefix has been updated to: \`${newPrefix}\``);
    } else {
      return message.reply('There was an error updating the prefix. Please try again later.');
    }
  }
}; 