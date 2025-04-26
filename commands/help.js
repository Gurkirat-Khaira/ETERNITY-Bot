const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildPrefix } = require('../utils/configUtils');
const { getDefaultCooldown } = require('../utils/rateLimit');
const fs = require('fs');
const path = require('path');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Shows help information about commands')
    .addStringOption(option =>
      option.setName('command')
        .setDescription('Get detailed information about a specific command')
        .setRequired(false)),
  
  cooldown: 3,
  aliases: ['h', 'commands'],
  
  async execute(interaction) {
    await interaction.deferReply();
    
    try {
      const commandName = interaction.options.getString('command');
      
      if (commandName) {
        // Show detailed help for a specific command
        await this.showCommandHelp(interaction, commandName);
      } else {
        // Show general help with all commands
        await this.showGeneralHelp(interaction);
      }
    } catch (error) {
      console.error('Error executing help command:', error);
      await interaction.editReply('There was an error fetching the help information.');
    }
  },
  
  async executeText(message, args, prefix) {
    try {
      const commandName = args[0];
      
      if (commandName) {
        // Show detailed help for a specific command
        await this.showTextCommandHelp(message, commandName, prefix);
      } else {
        // Show general help with all commands
        await this.showTextGeneralHelp(message, prefix);
      }
    } catch (error) {
      console.error('Error executing help command:', error);
      return message.reply('There was an error fetching the help information.');
    }
  },
  
  // Shared functions to reuse code
  
  /**
   * Shows help for all commands via slash command
   */
  async showGeneralHelp(interaction) {
    const prefix = await getGuildPrefix(interaction.guild.id);
    const commands = this.getCommandsMap();
    
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('ETERNITY Bot Help')
      .setDescription(`Use \`/help <command>\` or \`${prefix}help <command>\` to get detailed information about a specific command.`)
      .setFooter({ text: `Prefix: ${prefix} • Use ${prefix}help or /help <command> for detailed info` });
    
    // Group commands by category or similar functionality
    const streamCommands = [];
    const configCommands = [];
    const otherCommands = [];
    
    for (const [name, command] of commands) {
      // Skip hidden commands
      if (command.hidden) continue;
      
      const description = command.data.description || 'No description available';
      
      // Categorize commands
      if (['stats', 'leaderboard', 'history'].includes(name)) {
        streamCommands.push(`\`${name}\` - ${description}`);
      } else if (['setprefix', 'setnoti', 'reload'].includes(name)) {
        configCommands.push(`\`${name}\` - ${description}`);
      } else {
        otherCommands.push(`\`${name}\` - ${description}`);
      }
    }
    
    if (streamCommands.length > 0) {
      embed.addFields({ name: '📊 Stream Tracking', value: streamCommands.join('\n'), inline: false });
    }
    
    if (configCommands.length > 0) {
      embed.addFields({ name: '⚙️ Configuration', value: configCommands.join('\n'), inline: false });
    }
    
    if (otherCommands.length > 0) {
      embed.addFields({ name: '📌 Other Commands', value: otherCommands.join('\n'), inline: false });
    }
    
    return interaction.editReply({ embeds: [embed] });
  },
  
  /**
   * Shows help for a specific command via slash command
   */
  async showCommandHelp(interaction, commandName) {
    const commands = this.getCommandsMap();
    const prefix = await getGuildPrefix(interaction.guild.id);
    
    // Find command by name or alias
    let command = null;
    
    for (const [name, cmd] of commands) {
      if (name === commandName || (cmd.aliases && cmd.aliases.includes(commandName))) {
        command = cmd;
        break;
      }
    }
    
    if (!command) {
      return interaction.editReply(`Command \`${commandName}\` not found. Use \`/help\` to see all available commands.`);
    }
    
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`Command: ${command.data.name}`)
      .setDescription(command.data.description || 'No description available');
    
    // Add usage information
    const usage = this.getCommandUsage(command, prefix);
    if (usage) {
      embed.addFields({ name: 'Usage', value: usage, inline: false });
    }
    
    // Add aliases if any
    if (command.aliases && command.aliases.length > 0) {
      embed.addFields({ name: 'Aliases', value: command.aliases.map(a => `\`${a}\``).join(', '), inline: true });
    }
    
    // Add cooldown info
    const cooldown = command.cooldown || getDefaultCooldown(command.data.name);
    if (cooldown) {
      embed.addFields({ name: 'Cooldown', value: `${cooldown} seconds`, inline: true });
    }
    
    // Add permission requirements if any
    const permissions = this.getRequiredPermissions(command);
    if (permissions) {
      embed.addFields({ name: 'Required Permissions', value: permissions, inline: true });
    }
    
    // Add examples if possible
    const examples = this.getCommandExamples(command, prefix);
    if (examples) {
      embed.addFields({ name: 'Examples', value: examples, inline: false });
    }
    
    return interaction.editReply({ embeds: [embed] });
  },
  
  /**
   * Shows general help for text commands
   */
  async showTextGeneralHelp(message, prefix) {
    const commands = this.getCommandsMap();
    
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('ETERNITY Bot Help')
      .setDescription(`Use \`${prefix}help <command>\` or \`/help <command>\` to get detailed information about a specific command.`)
      .setFooter({ text: `Prefix: ${prefix} • Use ${prefix}help or /help <command> for detailed info` });
    
    // Group commands by category or similar functionality
    const streamCommands = [];
    const configCommands = [];
    const otherCommands = [];
    
    for (const [name, command] of commands) {
      // Skip hidden commands
      if (command.hidden) continue;
      
      const description = command.data.description || 'No description available';
      
      // Categorize commands
      if (['stats', 'leaderboard', 'history'].includes(name)) {
        streamCommands.push(`\`${name}\` - ${description}`);
      } else if (['setprefix', 'setnoti', 'reload'].includes(name)) {
        configCommands.push(`\`${name}\` - ${description}`);
      } else {
        otherCommands.push(`\`${name}\` - ${description}`);
      }
    }
    
    if (streamCommands.length > 0) {
      embed.addFields({ name: '📊 Stream Tracking', value: streamCommands.join('\n'), inline: false });
    }
    
    if (configCommands.length > 0) {
      embed.addFields({ name: '⚙️ Configuration', value: configCommands.join('\n'), inline: false });
    }
    
    if (otherCommands.length > 0) {
      embed.addFields({ name: '📌 Other Commands', value: otherCommands.join('\n'), inline: false });
    }
    
    return message.reply({ embeds: [embed] });
  },
  
  /**
   * Shows help for a specific command via text command
   */
  async showTextCommandHelp(message, commandName, prefix) {
    const commands = this.getCommandsMap();
    
    // Find command by name or alias
    let command = null;
    
    for (const [name, cmd] of commands) {
      if (name === commandName || (cmd.aliases && cmd.aliases.includes(commandName))) {
        command = cmd;
        break;
      }
    }
    
    if (!command) {
      return message.reply(`Command \`${commandName}\` not found. Use \`${prefix}help\` to see all available commands.`);
    }
    
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`Command: ${command.data.name}`)
      .setDescription(command.data.description || 'No description available');
    
    // Add usage information
    const usage = this.getCommandUsage(command, prefix);
    if (usage) {
      embed.addFields({ name: 'Usage', value: usage, inline: false });
    }
    
    // Add aliases if any
    if (command.aliases && command.aliases.length > 0) {
      embed.addFields({ name: 'Aliases', value: command.aliases.map(a => `\`${a}\``).join(', '), inline: true });
    }
    
    // Add cooldown info
    const cooldown = command.cooldown || getDefaultCooldown(command.data.name);
    if (cooldown) {
      embed.addFields({ name: 'Cooldown', value: `${cooldown} seconds`, inline: true });
    }
    
    // Add permission requirements if any
    const permissions = this.getRequiredPermissions(command);
    if (permissions) {
      embed.addFields({ name: 'Required Permissions', value: permissions, inline: true });
    }
    
    // Add examples if possible
    const examples = this.getCommandExamples(command, prefix);
    if (examples) {
      embed.addFields({ name: 'Examples', value: examples, inline: false });
    }
    
    return message.reply({ embeds: [embed] });
  },
  
  /**
   * Get a map of all available commands
   */
  getCommandsMap() {
    const commands = new Map();
    const commandsPath = path.join(__dirname, '../commands');
    
    if (fs.existsSync(commandsPath)) {
      const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
      
      for (const file of commandFiles) {
        try {
          const command = require(path.join(commandsPath, file));
          if (command.data && command.data.name) {
            commands.set(command.data.name, command);
          }
        } catch (error) {
          console.error(`Error loading command file ${file} for help:`, error);
        }
      }
    }
    
    return commands;
  },
  
  /**
   * Get formatted usage string for a command
   */
  getCommandUsage(command, prefix) {
    let usage = '';
    
    // If the command has help.usage, use that
    if (command.help && command.help.usage) {
      usage = `${prefix}${command.help.usage}`;
    } else {
      // Otherwise, generate something based on the slash command options
      usage = `${prefix}${command.data.name}`;
      
      if (command.data.options && command.data.options.length > 0) {
        command.data.options.forEach(option => {
          const optName = option.required ? `<${option.name}>` : `[${option.name}]`;
          usage += ` ${optName}`;
        });
      }
    }
    
    return `\`${usage}\``;
  },
  
  /**
   * Get examples for a command
   */
  getCommandExamples(command, prefix) {
    let examples = '';
    
    // If the command has help.examples, use those
    if (command.help && command.help.examples) {
      return command.help.examples.map(ex => `\`${prefix}${ex}\``).join('\n');
    }
    
    // Otherwise, generate basic examples
    switch (command.data.name) {
      case 'stats':
        examples = `\`${prefix}stats\` - Show your voice activity stats\n`;
        examples += `\`${prefix}stats stream\` - Show your streaming stats\n`;
        examples += `\`${prefix}stats stream week\` - Show your weekly streaming stats`;
        break;
      case 'leaderboard':
        examples = `\`${prefix}leaderboard\` - Show server stream leaderboard\n`;
        examples += `\`${prefix}leaderboard voice\` - Show voice activity leaderboard`;
        break;
      case 'history':
        examples = `\`${prefix}history\` - Show your stream history\n`;
        examples += `\`${prefix}history @User\` - Show another user's stream history`;
        break;
      case 'setprefix':
        examples = `\`${prefix}setprefix .\` - Change the prefix to .`;
        break;
      case 'setnoti':
        examples = `\`${prefix}setnoti #stream-notifications\` - Set stream notifications channel`;
        break;
      case 'help':
        examples = `\`${prefix}help\` - Show this help menu\n`;
        examples += `\`${prefix}help stats\` - Get detailed help for the stats command`;
        break;
      default:
        examples = `\`${prefix}${command.data.name}\``;
        break;
    }
    
    return examples;
  },
  
  /**
   * Get required permissions for a command
   */
  getRequiredPermissions(command) {
    // Check if command has explicit permission requirements
    if (command.data.default_member_permissions) {
      const permValue = command.data.default_member_permissions;
      
      if (permValue === PermissionFlagsBits.Administrator.toString()) {
        return 'Administrator';
      }
      // Add more permission checks as needed
    }
    
    // Special case for the reload command which explicitly checks for admin
    if (command.data.name === 'reload') {
      return 'Administrator';
    }
    
    return null;
  }
};