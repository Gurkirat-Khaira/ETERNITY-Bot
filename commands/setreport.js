const { EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');

module.exports = {
    name: 'setreport',
    description: 'Configure scheduled stream reports',
    usage: '[hourly|daily|off] [timezone]',
    permissions: ['ADMINISTRATOR'],
    aliases: ['streamreport', 'reportconfig'],
    
    data: new SlashCommandBuilder()
        .setName('setreport')
        .setDescription('Configure scheduled stream reports')
        .addStringOption(option => 
            option.setName('action')
                .setDescription('The action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'View current report settings', value: 'info' },
                    { name: 'Configure hourly reports', value: 'hourly' },
                    { name: 'Configure daily reports', value: 'daily' },
                    { name: 'Set timezone', value: 'timezone' },
                    { name: 'Disable all reports', value: 'off' }
                ))
        .addStringOption(option =>
            option.setName('enabled')
                .setDescription('Enable or disable reports (for hourly/daily)')
                .setRequired(false)
                .addChoices(
                    { name: 'On', value: 'on' },
                    { name: 'Off', value: 'off' }
                ))
        .addStringOption(option =>
            option.setName('timezone')
                .setDescription('Timezone for reports (e.g., UTC, America/New_York, Europe/London)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    cooldown: process.env.ADMIN_COOLDOWN || 0,
    
    async execute(interaction) {
        try {
            const guildConfig = await GuildConfig.findOne({ guildId: interaction.guild.id });
            
            if (!guildConfig) {
                return interaction.reply({ content: 'Guild configuration not found. Please set up the bot first.', ephemeral: true });
            }
            
            if (!guildConfig.notificationChannelId) {
                return interaction.reply({ content: `You must set a notification channel first using the /setnoti command.`, ephemeral: true });
            }
            
            const action = interaction.options.getString('action');
            
            if (action === 'info') {
                // Display current settings
                const embed = new EmbedBuilder()
                    .setTitle('Stream Report Settings')
                    .setColor('#0099ff')
                    .setDescription(`Current report settings for ${interaction.guild.name}`)
                    .addFields(
                        { name: 'Hourly Reports', value: guildConfig.hourlyReportEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Daily Reports', value: guildConfig.dailyReportEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Timezone', value: guildConfig.timezone || 'UTC', inline: true },
                        { name: 'Report Channel', value: `<#${guildConfig.notificationChannelId}>`, inline: true }
                    );
                
                return interaction.reply({ embeds: [embed] });
            }
            
            if (action === 'off') {
                // Disable both hourly and daily reports
                guildConfig.hourlyReportEnabled = false;
                guildConfig.dailyReportEnabled = false;
                await guildConfig.save();
                return interaction.reply({ content: 'All scheduled reports have been disabled.', ephemeral: true });
            }
            
            if (action === 'hourly') {
                const enabled = interaction.options.getString('enabled');
                
                if (!enabled) {
                    return interaction.reply({ 
                        content: 'Please specify whether to enable or disable hourly reports using the "enabled" option.',
                        ephemeral: true 
                    });
                }
                
                if (enabled === 'on') {
                    guildConfig.hourlyReportEnabled = true;
                } else if (enabled === 'off') {
                    guildConfig.hourlyReportEnabled = false;
                }
                
                await guildConfig.save();
                return interaction.reply({ 
                    content: `Hourly reports have been ${guildConfig.hourlyReportEnabled ? 'enabled' : 'disabled'}.`, 
                    ephemeral: true 
                });
            }
            
            if (action === 'daily') {
                const enabled = interaction.options.getString('enabled');
                
                if (!enabled) {
                    return interaction.reply({ 
                        content: 'Please specify whether to enable or disable daily reports using the "enabled" option.',
                        ephemeral: true 
                    });
                }
                
                if (enabled === 'on') {
                    guildConfig.dailyReportEnabled = true;
                } else if (enabled === 'off') {
                    guildConfig.dailyReportEnabled = false;
                }
                
                await guildConfig.save();
                return interaction.reply({ 
                    content: `Daily reports have been ${guildConfig.dailyReportEnabled ? 'enabled' : 'disabled'}. Reports will be sent at midnight in ${guildConfig.timezone || 'UTC'} timezone.`,
                    ephemeral: true 
                });
            }
            
            if (action === 'timezone') {
                const timezone = interaction.options.getString('timezone');
                
                if (!timezone) {
                    return interaction.reply({ 
                        content: 'Please specify a timezone (e.g., UTC, America/New_York, Europe/London) using the "timezone" option.',
                        ephemeral: true 
                    });
                }
                
                // Validate timezone by trying to create a date with it
                try {
                    new Date().toLocaleString('en-US', { timeZone: timezone });
                } catch (error) {
                    return interaction.reply({ 
                        content: `Invalid timezone: "${timezone}". Please use a valid IANA timezone identifier (e.g., UTC, America/New_York, Europe/London).`,
                        ephemeral: true 
                    });
                }
                
                guildConfig.timezone = timezone;
                await guildConfig.save();
                
                return interaction.reply({ 
                    content: `Timezone has been set to ${timezone}. Daily reports will be sent at midnight in this timezone.`,
                    ephemeral: true 
                });
            }
        } catch (error) {
            console.error('Error in setreport command:', error);
            return interaction.reply({ 
                content: 'An error occurred while configuring reporting settings.',
                ephemeral: true 
            });
        }
    },
    
    async executeText(message, args, prefix) {
        try {
            const guildConfig = await GuildConfig.findOne({ guildId: message.guild.id });
            
            if (!guildConfig) {
                return message.reply('Guild configuration not found. Please set up the bot first.');
            }
            
            if (!guildConfig.notificationChannelId) {
                return message.reply(`You must set a notification channel first using \`${prefix}setnoti\` command.`);
            }
            
            if (args.length === 0) {
                // Display current settings
                const embed = new EmbedBuilder()
                    .setTitle('Stream Report Settings')
                    .setColor('#0099ff')
                    .setDescription(`Current report settings for ${message.guild.name}`)
                    .addFields(
                        { name: 'Hourly Reports', value: guildConfig.hourlyReportEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Daily Reports', value: guildConfig.dailyReportEnabled ? 'Enabled' : 'Disabled', inline: true },
                        { name: 'Timezone', value: guildConfig.timezone || 'UTC', inline: true },
                        { name: 'Report Channel', value: `<#${guildConfig.notificationChannelId}>`, inline: true }
                    )
                    .addFields([{
                        name: 'Usage Examples', 
                        value: `${prefix}setreport hourly on - Enable hourly reports\n` +
                        `${prefix}setreport daily on - Enable daily reports\n` +
                        `${prefix}setreport timezone America/New_York - Set timezone\n` +
                        `${prefix}setreport off - Disable all reports`
                    }]);
                
                return message.channel.send({ embeds: [embed] });
            }
            
            const mode = args[0].toLowerCase();
            
            if (mode === 'off') {
                // Disable both hourly and daily reports
                guildConfig.hourlyReportEnabled = false;
                guildConfig.dailyReportEnabled = false;
                await guildConfig.save();
                return message.reply('All scheduled reports have been disabled.');
            }
            
            if (mode === 'hourly') {
                if (args[1] && args[1].toLowerCase() === 'on') {
                    guildConfig.hourlyReportEnabled = true;
                } else if (args[1] && args[1].toLowerCase() === 'off') {
                    guildConfig.hourlyReportEnabled = false;
                } else {
                    return message.reply(`Please specify 'on' or 'off' after 'hourly'. Example: \`${prefix}setreport hourly on\``);
                }
                
                await guildConfig.save();
                return message.reply(`Hourly reports have been ${guildConfig.hourlyReportEnabled ? 'enabled' : 'disabled'}.`);
            }
            
            if (mode === 'daily') {
                if (args[1] && args[1].toLowerCase() === 'on') {
                    guildConfig.dailyReportEnabled = true;
                    await guildConfig.save();
                    return message.reply(`Daily reports have been enabled. Reports will be sent at midnight in ${guildConfig.timezone || 'UTC'} timezone.`);
                } else if (args[1] && args[1].toLowerCase() === 'off') {
                    guildConfig.dailyReportEnabled = false;
                    await guildConfig.save();
                    return message.reply('Daily reports have been disabled.');
                } else {
                    return message.reply(`Please specify 'on' or 'off' after 'daily'. Example: \`${prefix}setreport daily on\``);
                }
            }
            
            if (mode === 'timezone') {
                if (!args[1]) {
                    return message.reply(`Please specify a timezone. Example: \`${prefix}setreport timezone America/New_York\``);
                }
                
                const timezone = args[1];
                
                // Validate timezone by trying to create a date with it
                try {
                    new Date().toLocaleString('en-US', { timeZone: timezone });
                } catch (error) {
                    return message.reply(`Invalid timezone: "${timezone}". Please use a valid IANA timezone identifier (e.g., UTC, America/New_York, Europe/London).`);
                }
                
                guildConfig.timezone = timezone;
                await guildConfig.save();
                
                return message.reply(`Timezone has been set to ${timezone}. Daily reports will be sent at midnight in this timezone.`);
            }
            
            return message.reply(`Unknown action. Valid actions are: hourly, daily, timezone, off. Type \`${prefix}setreport\` for more information.`);
        } catch (error) {
            console.error('Error in setreport command:', error);
            return message.reply('An error occurred while configuring reporting settings.');
        }
    }
}; 