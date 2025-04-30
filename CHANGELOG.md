# Changelog

All notable changes to the ETERNITY Stream Tracker bot will be documented in this file.

## [1.1.1] - 2025-04-30

### Fixed
- Fixed daily reports to show previous day's data instead of current day
- Updated welcome message with correct command names and additional features
- Improved report message formatting for clarity

## [1.1.0] - 2025-04-28

### Added
- Comprehensive automated reporting system
  - Hourly reports summarizing stream activity
  - Daily reports with stream statistics
  - Configurable timezone support for more accurate reporting
  - Pagination for reports with many streams
- New `!setreport` command with expanded options:
  - View current report configuration
  - Toggle hourly reports on/off
  - Toggle daily reports on/off
  - Set custom timezone for the server
- Added rich embed formatting for all reports
- Support for detecting interrupted streams

### Fixed
- Fixed issue with sending paginated embeds to notification channels
- Improved error handling for report generation
- Fixed time calculation in daily report summaries

## [1.0.0] - 2025-04-26

### Initial Release
- Stream notification system
- Stream tracking and statistics
- Leaderboard functionality
- Command system with customizable prefix
- Basic notification controls 