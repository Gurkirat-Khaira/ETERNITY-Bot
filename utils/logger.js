/**
 * Enhanced logging utility
 * Provides structured logging with levels and request tracking
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
require('dotenv').config();

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// Current log level from environment or default to INFO
const currentLogLevel = process.env.LOG_LEVEL 
  ? (LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] || LOG_LEVELS.INFO)
  : process.env.DEBUG === 'true' ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;

// Check if debug mode is enabled
const isDebugEnabled = process.env.DEBUG === 'true';

// Keep some logs in memory for quick access
const memoryLogs = {
  errors: [], // Last 100 errors
  requests: new Map(), // Request tracking by ID
  stats: {
    errors: 0,
    warnings: 0,
    infos: 0,
    debugs: 0
  }
};

// Max logs to keep in memory
const MAX_MEMORY_LOGS = 100;

// Log file paths
const LOG_DIR = path.join(process.cwd(), 'logs');
const ERROR_LOG_PATH = path.join(LOG_DIR, 'error.log');
const COMBINED_LOG_PATH = path.join(LOG_DIR, 'combined.log');

// Ensure log directory exists if debug is enabled
if (isDebugEnabled && !fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Format a log message with timestamp and metadata
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata
 * @returns {string} Formatted log string
 */
function formatLogMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  
  // Add request ID if provided
  const requestId = meta.requestId || '';
  
  // Format metadata as string, filtering out requestId which we handle separately
  const { requestId: _, ...metaWithoutRequestId } = meta;
  const metaString = Object.keys(metaWithoutRequestId).length > 0 
    ? JSON.stringify(metaWithoutRequestId) 
    : '';
  
  return `[${timestamp}] [${level.padEnd(5)}]${requestId ? ` [${requestId}]` : ''} ${message}${metaString ? ` ${metaString}` : ''}`;
}

/**
 * Write a message to log files and console
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata
 */
function log(level, message, meta = {}) {
  // Check if this log level should be processed
  if (LOG_LEVELS[level] > currentLogLevel) return;

  // Format the log message
  const formattedMessage = formatLogMessage(level, message, meta);
  
  // Add to in-memory logs if it's an error
  if (level === 'ERROR') {
    memoryLogs.errors.unshift({
      timestamp: new Date(),
      message,
      meta
    });
    
    // Keep only the last MAX_MEMORY_LOGS
    if (memoryLogs.errors.length > MAX_MEMORY_LOGS) {
      memoryLogs.errors.pop();
    }
    
    memoryLogs.stats.errors++;
    
    // Write to error log file if debug is enabled
    if (isDebugEnabled) {
      fs.appendFile(ERROR_LOG_PATH, formattedMessage + '\n', (err) => {
        if (err) console.error('Failed to write to error log:', err);
      });
    }
  } else if (level === 'WARN') {
    memoryLogs.stats.warnings++;
  } else if (level === 'INFO') {
    memoryLogs.stats.infos++;
  } else if (level === 'DEBUG') {
    memoryLogs.stats.debugs++;
  }
  
  // Write to combined log file if debug is enabled
  if (isDebugEnabled) {
    fs.appendFile(COMBINED_LOG_PATH, formattedMessage + '\n', (err) => {
      if (err) console.error('Failed to write to combined log:', err);
    });
  }
  
  // Output to console if debug is enabled or it's an error
  if (isDebugEnabled || level === 'ERROR') {
    let consoleMethod = console.log;
    let consoleColor = '\x1b[0m'; // Reset color
    
    switch (level) {
      case 'ERROR':
        consoleMethod = console.error;
        consoleColor = '\x1b[31m'; // Red
        break;
      case 'WARN':
        consoleMethod = console.warn;
        consoleColor = '\x1b[33m'; // Yellow
        break;
      case 'INFO':
        consoleColor = '\x1b[36m'; // Cyan
        break;
      case 'DEBUG':
        consoleColor = '\x1b[90m'; // Gray
        break;
    }
    
    consoleMethod(`${consoleColor}${formattedMessage}\x1b[0m`);
  }
}

/**
 * Start tracking a request
 * @param {string} context - Context description (e.g., 'command:stats')
 * @param {Object} data - Initial request data
 * @returns {string} Request ID
 */
function startRequest(context, data = {}) {
  const requestId = randomUUID();
  const startTime = Date.now();
  
  memoryLogs.requests.set(requestId, {
    id: requestId,
    context,
    startTime,
    data,
    steps: []
  });
  
  log('DEBUG', `Starting ${context}`, { requestId });
  return requestId;
}

/**
 * Add a step to a request's tracked journey
 * @param {string} requestId - Request ID
 * @param {string} step - Step description
 * @param {Object} data - Step data
 */
function addRequestStep(requestId, step, data = {}) {
  if (!memoryLogs.requests.has(requestId)) return;
  
  const request = memoryLogs.requests.get(requestId);
  request.steps.push({
    time: Date.now(),
    step,
    data
  });
  
  log('DEBUG', `${request.context} - ${step}`, { requestId, ...data });
}

/**
 * End a tracked request
 * @param {string} requestId - Request ID
 * @param {boolean} success - Whether the request succeeded
 * @param {Object} finalData - Final request data
 */
function endRequest(requestId, success = true, finalData = {}) {
  if (!memoryLogs.requests.has(requestId)) return;
  
  const request = memoryLogs.requests.get(requestId);
  const endTime = Date.now();
  const duration = endTime - request.startTime;
  
  log(
    success ? 'INFO' : 'WARN',
    `${request.context} ${success ? 'completed' : 'failed'} in ${duration}ms`,
    { 
      requestId,
      duration,
      ...finalData
    }
  );
  
  // Remove from tracking map after a delay to allow for any last logging
  setTimeout(() => {
    memoryLogs.requests.delete(requestId);
  }, 10000);
  
  return duration;
}

/**
 * Get recent errors from memory
 * @returns {Array} Recent errors
 */
function getRecentErrors() {
  return [...memoryLogs.errors];
}

/**
 * Get logging statistics
 * @returns {Object} Logging stats
 */
function getStats() {
  return { 
    ...memoryLogs.stats,
    activeRequests: memoryLogs.requests.size
  };
}

// Export utility functions
module.exports = {
  // Log level functions
  error: (message, meta = {}) => log('ERROR', message, meta),
  warn: (message, meta = {}) => log('WARN', message, meta),
  info: (message, meta = {}) => log('INFO', message, meta),
  debug: (message, meta = {}) => log('DEBUG', message, meta),
  
  // Request tracking
  startRequest,
  addRequestStep,
  endRequest,
  
  // Stats and diagnostics
  getRecentErrors,
  getStats,
  
  // Constants for external use
  LOG_LEVELS
}; 