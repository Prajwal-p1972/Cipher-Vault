import mongoose from 'mongoose';
import { env } from './env.js';

/**
 * Connect to MongoDB instance using Mongoose.
 * Document keys and plaintext are NEVER stored here; only metadata and audit logs.
 */
export async function connectDB() {
  try {
    const conn = await mongoose.connect(env.MONGO_URI, {
      autoIndex: true
    });
    console.log(`[Database] Connected to MongoDB: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[Database] MongoDB connection error: ${error.message}`);
    throw error;
  }
}

/**
 * Gracefully disconnect from MongoDB.
 */
export async function disconnectDB() {
  try {
    await mongoose.disconnect();
    console.log('[Database] MongoDB connection closed');
  } catch (error) {
    console.error(`[Database] Error during disconnect: ${error.message}`);
  }
}
