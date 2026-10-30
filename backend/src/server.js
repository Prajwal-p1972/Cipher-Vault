import http from 'node:http';
import app from './app.js';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { initSocketServer, closeSocketServer } from './realtime/socketServer.js';

// HTTP server instance allows socket.io attachment in Phase 3
const server = http.createServer(app);

// Initialize WebSockets
initSocketServer(server);

async function start() {
  try {
    await connectDB();
  } catch (err) {
    console.error(`[FATAL] Database connection failed: ${err.message}`);
    process.exit(1);
  }

  server.listen(env.PORT, () => {
    console.log(`[Cipher Vault] Listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Cipher Vault] Received ${signal}. Commencing graceful shutdown...`);

  server.close(async () => {
    try {
      await closeSocketServer();
      await disconnectDB();
      console.log('[Cipher Vault] Graceful shutdown complete. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('[Cipher Vault] Error during database disconnection:', err.message);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error('[Cipher Vault] Shutdown timeout exceeded. Forcing termination.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

start();

export { server };
