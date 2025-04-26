const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * Create a paginated embed system with navigation buttons
 * @param {Object} interaction - Discord interaction or message object
 * @param {Array<EmbedBuilder>} pages - Array of embeds to paginate
 * @param {Boolean} ephemeral - Whether the response should be ephemeral (for slash commands)
 * @param {Number} timeout - Timeout in milliseconds before buttons are disabled
 * @returns {Promise<void>}
 */
async function createPaginatedEmbed(interaction, pages, ephemeral = false, timeout = 120000) {
  if (!pages || pages.length === 0) return;
  
  // If only one page, just send it without buttons
  if (pages.length === 1) {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply({ embeds: [pages[0]], components: [] });
    } else {
      return await interaction.reply({ embeds: [pages[0]], ephemeral });
    }
  }
  
  let currentPage = 0;
  
  // Create button row
  const getRow = (currentPage) => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('first')
        .setLabel('⏮')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('previous')
        .setLabel('◀️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('pageIndicator')
        .setLabel(`Page ${currentPage + 1}/${pages.length}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('next')
        .setLabel('▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === pages.length - 1),
      new ButtonBuilder()
        .setCustomId('last')
        .setLabel('⏭')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === pages.length - 1)
    );
    
    return row;
  };
  
  // Send initial message with buttons
  let message;
  if (interaction.replied || interaction.deferred) {
    message = await interaction.editReply({
      embeds: [pages[currentPage]],
      components: [getRow(currentPage)]
    });
  } else {
    message = await interaction.reply({
      embeds: [pages[currentPage]],
      components: [getRow(currentPage)],
      ephemeral,
      fetchReply: true
    });
  }
  
  // Create collector for button interactions
  const collector = message.createMessageComponentCollector({ 
    filter: i => {
      if (interaction.user) {
        return i.user.id === interaction.user.id;
      } else {
        return i.user.id === interaction.author.id;
      }
    },
    time: timeout 
  });
  
  collector.on('collect', async (buttonInt) => {
    // Acknowledge the button interaction immediately
    await buttonInt.deferUpdate();
    
    // Handle button actions
    switch (buttonInt.customId) {
      case 'first':
        currentPage = 0;
        break;
      case 'previous':
        currentPage = Math.max(0, currentPage - 1);
        break;
      case 'next':
        currentPage = Math.min(pages.length - 1, currentPage + 1);
        break;
      case 'last':
        currentPage = pages.length - 1;
        break;
      default:
        break;
    }
    
    // Update the message with new embed and buttons
    await buttonInt.editReply({
      embeds: [pages[currentPage]],
      components: [getRow(currentPage)]
    });
  });
  
  // When collector expires, edit message to remove buttons
  collector.on('end', () => {
    if (message) {
      const embed = pages[currentPage];
      message.edit({ embeds: [embed], components: [] }).catch(err => {});
    }
  });
}

module.exports = {
  createPaginatedEmbed
}; 