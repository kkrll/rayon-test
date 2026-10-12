/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5180,
    strictPort: true,
    // IPv4 loopback: Tailscale Serve proxies to 127.0.0.1, and `localhost`
    // resolves to ::1 only on this host. Its *.ts.net name must pass the host check.
    host: '127.0.0.1',
    allowedHosts: ['.ts.net'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
