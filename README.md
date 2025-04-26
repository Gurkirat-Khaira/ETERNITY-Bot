# ETERNITY Stream Tracker

A Discord bot for tracking and managing Discord streaming activity in servers. This bot allows server owners to set up automatic notifications when members go live using Discord's built-in streaming feature, track streaming statistics, and manage streaming-related configurations.

## Features

- **Stream Notifications**: Automatic notifications when members start Discord streaming
- **Stream Tracking**: Records stream duration and other statistics
- **Leaderboards**: View top streamers in your server
- **Statistics**: Check individual and server-wide streaming statistics
- **Customizable Prefix**: Set a custom command prefix for your server
- **Notification Control**: Configure where and how notifications appear

## Installation

### Prerequisites

- Node.js 16.9.0 or higher
- MongoDB database
- Discord Bot Token

### Setup

1. Clone the repository
   ```
   git clone https://github.com/Gurkirat-Khaira/ETERNITY-Bot.git
   cd ETERNITY-Bot
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```
   DISCORD_TOKEN=your_discord_token
   MONGODB_URI=your_mongodb_connection_string
   CLIENT_ID=your_bot_client_id
   DEFAULT_PREFIX=!
   DEFAULT_COOLDOWN=3
   STATS_COOLDOWN=5
   ADMIN_COOLDOWN=0
   DEBUG=false
   ```

4. Start the bot
   ```
   npm start
   ```

## Commands

- `!help` - Displays available commands
- `!stats [user]` - View streaming statistics for a user or yourself
- `!leaderboard` - View top streamers in the server
- `!history [user]` - View recent streaming history
- `!setprefix <prefix>` - Change the command prefix for your server
- `!setnoti <channel>` - Set the notification channel for stream alerts
- `!reload` - Reload bot commands (admin only)

## How It Works

ETERNITY Stream Tracker detects when users in your server start or stop streaming through Discord's built-in "Go Live" feature. It doesn't integrate with external streaming platforms like Twitch or YouTube - it only tracks streams happening directly within Discord.

When a member goes live in a voice channel, the bot will:
1. Send a notification to the designated channel
2. Track the stream's duration
3. Update the user's streaming statistics
4. Detect if a stream was interrupted (by crashes or disconnects)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License](http://creativecommons.org/licenses/by-nc/4.0/) - see the LICENSE file for details.

This means you are free to:
- Share — copy and redistribute the material in any medium or format
- Adapt — remix, transform, and build upon the material

Under the following terms:
- **Attribution** — You must give appropriate credit, provide a link to the license, and indicate if changes were made.
- **NonCommercial** — You may not use the material for commercial purposes.

## Acknowledgments

- [discord.js](https://discord.js.org/) for the Discord API library
- All contributors and testers who have helped improve this bot

## Contact

Gurkirat Khaira - [GitHub Profile](https://github.com/Gurkirat-Khaira)

Project Link: [https://github.com/Gurkirat-Khaira/ETERNITY-Bot](https://github.com/Gurkirat-Khaira/ETERNITY-Bot) 