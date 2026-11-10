import { readFileSync } from 'node:fs';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'DEV_HTTPS_');
  const certPath = env.DEV_HTTPS_CERT;
  const keyPath = env.DEV_HTTPS_KEY;
  if (mode === 'lan' && Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error('Set both DEV_HTTPS_CERT and DEV_HTTPS_KEY, or neither.');
  }
  const https = mode === 'lan' && certPath && keyPath
    ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
    : undefined;

  return {
    plugins: mode === 'lan' && !https ? [basicSsl()] : [],
    server: {
      port: 5173,
      strictPort: true,
      ...(https ? { https } : {}),
    },
  };
});
