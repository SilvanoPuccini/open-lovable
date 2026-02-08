import { NextRequest, NextResponse } from 'next/server';
import FirecrawlApp from '@mendable/firecrawl-js';
import { validateUrl, checkRateLimit, getClientId } from '@/lib/security';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientId = getClientId(request);
    const rateCheck = checkRateLimit(`scrape:${clientId}`, 10, 60_000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded. Try again later.' },
        { status: 429 }
      );
    }

    const { url, formats = ['markdown', 'html'], options = {} } = await request.json();

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
        { success: false, error: 'Scraping service is not configured.' },
        { status: 503 }
      );
    }

    const app = new FirecrawlApp({ apiKey });

    const scrapeResult = await app.scrape(url, {
      formats,
      onlyMainContent: options.onlyMainContent !== false,
      waitFor: options.waitFor || 2000,
      timeout: options.timeout || 30000,
    });

    const result = scrapeResult as Record<string, any>;
    if (result.success === false) {
      return NextResponse.json(
        { success: false, error: 'Failed to scrape website.' },
        { status: 502 }
      );
    }

    const data = result.data || result;

    return NextResponse.json({
      success: true,
      data: {
        title: data?.metadata?.title || 'Untitled',
        content: data?.markdown || data?.html || '',
        description: data?.metadata?.description || '',
        markdown: data?.markdown || '',
        html: data?.html || '',
        metadata: data?.metadata || {},
        screenshot: data?.screenshot || null,
        links: data?.links || [],
      },
    });
  } catch (error) {
    console.error('Error scraping website:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to scrape website',
      },
      { status: 500 }
    );
  }
}
