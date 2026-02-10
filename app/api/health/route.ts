import { NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { getDbStatus } from '@/lib/db';

/**
 * Health check endpoint for monitoring and deployment verification.
 * GET /api/health
 *
 * Returns:
 * - status: "healthy" | "degraded"
 * - version: app version from package.json
 * - uptime: process uptime in seconds
 * - sandbox: sandbox provider availability
 * - services: status of configured external services
 */
export async function GET() {
  const startTime = Date.now();

  const services: Record<string, { configured: boolean }> = {
    firecrawl: { configured: !!process.env.FIRECRAWL_API_KEY },
    anthropic: { configured: !!process.env.ANTHROPIC_API_KEY },
    openai: { configured: !!process.env.OPENAI_API_KEY },
    google: { configured: !!process.env.GEMINI_API_KEY },
    groq: { configured: !!process.env.GROQ_API_KEY },
    aiGateway: { configured: !!process.env.AI_GATEWAY_API_KEY },
    morph: { configured: !!process.env.MORPH_API_KEY },
  };

  const sandboxProvider = process.env.SANDBOX_PROVIDER || 'e2b';
  const sandboxConfigured =
    sandboxProvider === 'e2b'
      ? !!process.env.E2B_API_KEY
      : !!(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN);

  const hasAiProvider =
    services.aiGateway.configured ||
    services.anthropic.configured ||
    services.openai.configured ||
    services.google.configured ||
    services.groq.configured;

  const dbStatus = getDbStatus();

  const activeProvider = sandboxManager.getActiveProvider();
  const status = hasAiProvider && sandboxConfigured ? 'healthy' : 'degraded';

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      responseTime: Date.now() - startTime,
      environment: process.env.NODE_ENV || 'development',
      sandbox: {
        provider: sandboxProvider,
        configured: sandboxConfigured,
        active: !!activeProvider,
      },
      database: dbStatus,
      services,
      checks: {
        aiProvider: hasAiProvider,
        sandboxProvider: sandboxConfigured,
        database: dbStatus.configured,
        scraping: services.firecrawl.configured,
      },
    },
    { status: status === 'healthy' ? 200 : 503 }
  );
}
