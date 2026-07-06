import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env, assertSafeAuthConfig } from './config/env';
import { ApiError, sendError } from './lib/envelope';
import { attachRequestContext } from './plugins/context';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { adminRoutes } from './routes/admin';
import { chatRoutes } from './routes/chat';
import { callRoutes } from './routes/calls';
import { UserService } from './services/users';
import { attachWebSocketGateway, localConnectionCount } from './ws/gateway';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.isProd ? 'info' : 'debug' },
    bodyLimit: env.mediaMaxBytes + 1_048_576,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    // Allow the FE's auth + context headers (§7.1) through preflight.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-User-Token',
      'X-Client-Token',
      'X-Device-Type',
      'X-Language',
      'X-User-ID',
    ],
  });
  await app.register(multipart, { limits: { fileSize: env.mediaMaxBytes } });

  attachRequestContext(app);

  // Uniform localized error envelope (§6.1 / §8.3). Unknown errors → 500 internal_error.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      if (err.httpStatus === 429 && err.extra?.retry_after != null) {
        reply.header('Retry-After', String(err.extra.retry_after));
      }
      return sendError(reply, err, req.language);
    }
    if ((err as { statusCode?: number }).statusCode === 413) {
      return sendError(reply, new ApiError(413, 'file_too_large'), req.language);
    }
    req.log.error(err);
    return sendError(reply, new ApiError(500, 'internal_error'), req.language);
  });

  app.get('/health', async () => ({ ok: true, ws_connections: localConnectionCount() }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(adminRoutes);
  await app.register(chatRoutes);
  await app.register(callRoutes);

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  assertSafeAuthConfig(); // refuse to boot with the test hatch enabled in production (§3.1)
  const app = await buildServer();
  // Provision the admin role for ADMIN_PHONE (ops-only; never via API).
  await UserService.ensureAdmin(env.adminPhone).catch((e) => app.log.error({ e }, 'admin seed failed'));
  await app.listen({ port: env.port, host: '0.0.0.0' });
  // Attach the WS gateway to Fastify's underlying HTTP server for /v1/chat/ws upgrades.
  attachWebSocketGateway(app.server);
  app.log.info(`WS gateway attached at ws://localhost:${env.port}/v1/chat/ws`);
  return app;
}
