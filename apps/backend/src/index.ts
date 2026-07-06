import { startServer } from './server';

startServer().catch((err) => {
  console.error('failed to start server:', err);
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} received, shutting down`);
    process.exit(0);
  });
}
