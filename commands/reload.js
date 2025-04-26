const { SlashCommandBuilder, PermissionFlagsBits, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Reload all slash commands for the bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  // Slash command execution
  async execute(interaction) {
    // Check if user has admin permissions
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({
        content: 'You need Administrator permissions to use this command.',
        ephemeral: true
      });
    }
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      // Construct and prepare the REST module
      const rest = new REST().setToken(process.env.DISCORD_TOKEN);
      
      // First, delete all existing global commands
      await interaction.editReply('Removing existing commands...');
      
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: [] }
      );
      
      // Then, register all command files
      const commands = [];
      const commandsPath = path.join(__dirname, '../commands');
      const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
      
      // Load command data
      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        // Delete the command module from require cache to ensure fresh loading
        delete require.cache[require.resolve(filePath)];
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
          commands.push(command.data.toJSON());
        } else {
          console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
      }
      
      // Update with new commands
      await interaction.editReply(`Registering ${commands.length} commands...`);
      
      const data = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      
      await interaction.editReply(`Successfully reloaded ${data.length} application (/) commands!`);
    } catch (error) {
      console.error(error);
      await interaction.editReply(`There was an error reloading commands: ${error.message}`);
    }
  },
  
  // Text command execution
  async executeText(message, args, prefix) {
    // Check if user has admin permissions
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('You need Administrator permissions to use this command.');
    }
    
    const loadingMsg = await message.reply('Reloading commands...');
    
    try {
      // Construct and prepare the REST module
      const rest = new REST().setToken(process.env.DISCORD_TOKEN);
      
      // First, delete all existing global commands
      await loadingMsg.edit('Removing existing commands...');
      
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: [] }
      );
      
      // Then, register all command files
      const commands = [];
      const commandsPath = path.join(__dirname, '../commands');
      const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
      
      // Load command data
      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        // Delete the command module from require cache to ensure fresh loading
        delete require.cache[require.resolve(filePath)];
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
          commands.push(command.data.toJSON());
        } else {
          console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
      }
      
      // Update with new commands
      await loadingMsg.edit(`Registering ${commands.length} commands...`);
      
      const data = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      
      await loadingMsg.edit(`Successfully reloaded ${data.length} application (/) commands!`);
    } catch (error) {
      console.error(error);
      await loadingMsg.edit(`There was an error reloading commands: ${error.message}`);
    }
  }
}; 