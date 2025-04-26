const mongoose = require('mongoose');
require('dotenv').config();

// Import logger if exists or create a simplified version
let logger;
try {
  logger = require('../utils/logger');
} catch (error) {
  // Fallback logger for when the main logger isn't available
  logger = {
    error: (msg, meta) => console.error(msg, meta),
    warn: (msg, meta) => console.warn(msg, meta),
    info: (msg, meta) => console.log(msg, meta),
    debug: (msg, meta) => process.env.DEBUG === 'true' ? console.log(msg, meta) : null
  };
}

/**
 * MongoDB connection options for better reliability
 * These settings provide sensible defaults for a Discord bot
 */
const connectionOptions = {
  // Modern MongoDB driver enables useNewUrlParser and useUnifiedTopology by default
  serverSelectionTimeoutMS: 10000,  // Timeout after 10 seconds
  socketTimeoutMS: 45000,           // Close sockets after 45 seconds of inactivity
  family: 4,                        // Use IPv4, skip IPv6
  retryWrites: true                 // Automatically retry failed write operations
};

// Track connection state for reconnection logic
let isConnectedBefore = false;
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 5000; // 5 seconds between reconnection attempts

/**
 * Connect to MongoDB with retry mechanism
 * @returns {Promise<Object>} Mongoose connection instance
 */
const connectDB = async () => {
  try {
    connectionAttempts++;
    
    // Always show connection attempts in the console
    console.log(`Connecting to MongoDB... (attempt ${connectionAttempts})`);
    
    // Attempt to connect with the provided URI and options
    const conn = await mongoose.connect(process.env.MONGODB_URI, connectionOptions);
    
    // Set up connection event handlers only on first attempt to avoid duplicates
    if (connectionAttempts === 1) {
      setupConnectionHandlers(conn);
    }
    
    // Return the connection
    return conn;
  } catch (error) {
    // Always show connection errors in the console
    console.error(`Error connecting to MongoDB: ${error.message}`);
    logger.error('MongoDB connection error', { error: error.message, stack: error.stack });
    
    // Try to reconnect if we haven't reached max attempts
    if (connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
      console.log(`Attempting to reconnect (${connectionAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      logger.info(`Attempting MongoDB reconnection`, { attempt: connectionAttempts, max: MAX_RECONNECT_ATTEMPTS });
      
      // Wait for RECONNECT_INTERVAL milliseconds before trying again
      return new Promise(resolve => {
        setTimeout(() => resolve(connectDB()), RECONNECT_INTERVAL);
      });
    } else {
      // If we've reached max attempts, exit the process
      console.error(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Exiting...`);
      logger.error('Maximum MongoDB reconnection attempts reached', { max: MAX_RECONNECT_ATTEMPTS });
      process.exit(1);
    }
  }
};

/**
 * Setup MongoDB connection event handlers
 * @param {Object} conn - Mongoose connection object
 */
function setupConnectionHandlers(conn) {
  // When successfully connected
  mongoose.connection.on('connected', () => {
    isConnectedBefore = true;
    connectionAttempts = 0;
    // Log the successful connection
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    logger.info('MongoDB connected successfully', { host: conn.connection.host });
  });
  
  // When disconnected
  mongoose.connection.on('disconnected', () => {
    console.log('❌ MongoDB disconnected');
    logger.warn('MongoDB disconnected');
    
    // Only try to reconnect if we were previously connected and haven't exceeded max attempts
    if (isConnectedBefore && connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
      connectionAttempts++;
      console.log(`Attempting to reconnect (${connectionAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      logger.info(`Attempting MongoDB reconnection`, { attempt: connectionAttempts, max: MAX_RECONNECT_ATTEMPTS });
      setTimeout(connectDB, RECONNECT_INTERVAL);
    } else if (connectionAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Please check your database connection.`);
      logger.error('Maximum MongoDB reconnection attempts reached', { max: MAX_RECONNECT_ATTEMPTS });
    }
  });
  
  // When connection error occurs
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
    logger.error('MongoDB connection error', { error: err.message });
    
    // Try to reconnect if we haven't exceeded max attempts
    if (connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
      connectionAttempts++;
      console.log(`Attempting to reconnect (${connectionAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      logger.info(`Attempting MongoDB reconnection`, { attempt: connectionAttempts, max: MAX_RECONNECT_ATTEMPTS });
      setTimeout(connectDB, RECONNECT_INTERVAL);
    }
  });
  
  // When reconnected
  mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB reconnected successfully');
    logger.info('MongoDB reconnected successfully');
    connectionAttempts = 0;
  });
}

/**
 * Gracefully close the database connection
 * @param {String} signal - Signal that triggered shutdown
 * @returns {Function} Async handler function for signal
 */
const gracefulShutdown = (signal) => {
  return async () => {
    console.log(`Received ${signal}. Closing MongoDB connection...`);
    logger.info(`Graceful shutdown triggered by ${signal}`);
    
    // Set up a fail-safe timeout that will force exit if mongoose doesn't close properly
    const forceExitTimeout = setTimeout(() => {
      console.error('Could not close MongoDB connections in time, forcefully shutting down');
      logger.error('MongoDB connection timeout, forcing shutdown');
      process.exit(1);
    }, 3000);
    
    try {
      // Use mongoose's close method to properly clean up connections
      await mongoose.connection.close();
      console.log('MongoDB connection closed successfully');
      logger.info('MongoDB connection closed successfully');
      
      // Clear the timeout since we successfully closed the connection
      clearTimeout(forceExitTimeout);
      process.exit(0);
    } catch (err) {
      console.error('Error during MongoDB connection close:', err);
      logger.error('Error closing MongoDB connection', { error: err.message, stack: err.stack });
      
      // Clear the timeout since we're exiting anyway
      clearTimeout(forceExitTimeout);
      process.exit(1);
    }
  };
};

// Register User Signal (USR2) shutdown handler (used by some process managers)
process.once('SIGUSR2', gracefulShutdown('SIGUSR2'));

// Export the connection function
module.exports = connectDB;
