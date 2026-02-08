import { NextRequest, NextResponse } from 'next/server';
import FirecrawlApp from '@mendable/firecrawl-js';
import { validateUrl, checkRateLimit, getClientId } from '@/lib/security';

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const clientId = getClientId(req);
    const rateCheck = checkRateLimit(`scrape:${clientId}`, 10, 60_000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again later.' },
        { status: 429 }
      );
    }

    const { url } = await req.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate URL to prevent SSRF
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      return NextResponse.json({ error: urlValidation.error }, { status: 400 });
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;

    if (!apiKey) {
      console.error('FIRECRAWL_API_KEY not configured');
      return NextResponse.json(
        { error: 'Firecrawl API key not configured' },
        { status: 503 }
      );
    }

    const app = new FirecrawlApp({ apiKey });

    const scrapeResult = await app.scrape(url, {
      formats: ['screenshot'],
      waitFor: 3000,
      timeout: 30000,
      onlyMainContent: false,
      actions: [{ type: 'wait', milliseconds: 2000 }],
    });

    if (scrapeResult && scrapeResult.screenshot) {
      return NextResponse.json({
        success: true,
        screenshot: scrapeResult.screenshot,
        metadata: scrapeResult.metadata || {},
      });
    }

    const resultAny = scrapeResult as Record<string, any>;
    if (resultAny?.data?.screenshot) {
      return NextResponse.json({
        success: true,
        screenshot: resultAny.data.screenshot,
        metadata: resultAny.data.metadata || {},
      });
    }

    if (resultAny?.success === false) {
      console.error('[scrape-screenshot] Firecrawl API error:', resultAny.error);
      return NextResponse.json(
        { error: 'Failed to capture screenshot.' },
        { status: 502 }
      );
    }

    console.error('[scrape-screenshot] No screenshot in response');
    return NextResponse.json(
      { error: 'Screenshot not available in response.' },
      { status: 502 }
    );
  } catch (error) {
    console.error('[scrape-screenshot] Screenshot capture error:', error);
    return NextResponse.json(
      { error: 'Failed to capture screenshot.' },
      { status: 500 }
    );
  }
}
