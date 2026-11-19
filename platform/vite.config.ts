import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The big screen is a plain page in public/, outside the app bundle. When it follows an event from another device it
 * reads the show from the same backend as the app, so the build writes it a small file saying where that is. These are
 * the same public values the app bundle already carries.
 */
function screenConfig(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const body = JSON.stringify({ url: env.VITE_SUPABASE_URL ?? null, anonKey: env.VITE_SUPABASE_ANON_KEY ?? null, schema: env.VITE_SUPABASE_DB_SCHEMA ?? 'public' });
  return {
    name: 'sri-screen-config',
    configureServer(server) {
      server.middlewares.use('/graphics/platform.json', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(body); });
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'graphics/platform.json', source: body }); },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [screenConfig(mode)],
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
}));
