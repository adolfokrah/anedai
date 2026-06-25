import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The agent SDK + e2b run only on the server; keep them external to the
  // server bundle so their native/dynamic requires resolve at runtime.
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk', '@daytonaio/sdk'],
};

export default nextConfig;
