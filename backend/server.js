import http from 'node:http';
import app from './app.js';
import { env } from './src/config/env.js';
import { connectDB, disconnectDB } from './src/config/db.js';

// Create standard HTTP server instance to allow Socket.io attachment in Phase 3
const server = http.createServer(app);

async function startServer() {
  try {
    // Connect to database before opening HTTP socket
    await connectDB();

    server.listen(env.PORT, () => {
      console.log(`[Cipher Vault] Server listening securely on port ${env.PORT} (${env.NODE_ENV})`);
    });
  } catch (err) {
    console.error('[Cipher Vault] Startup failure:', err);
    process.exit(1);
  }
}

// Graceful Shutdown Handler
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Cipher Vault] Received ${signal}. Commencing graceful shutdown...`);

  server.close(async () => {
    console.log('[Cipher Vault] HTTP server connections closed.');
    try {
      await disconnectDB();
      console.log('[Cipher Vault] Graceful shutdown complete. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('[Cipher Vault] Error during database shutdown:', err);
      process.exit(1);
    }
  });

  // Force shutdown after timeout if pending connections hang
  setTimeout(() => {
    console.error('[Cipher Vault] Shutdown timed out. Forcing process termination.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startServer();

export { server };
