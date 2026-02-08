import { NextRequest, NextResponse } from 'next/server';
import { validateUrl, checkRateLimit, getClientId } from '@/lib/security';

/**
 * Sanitizes smart quotes and other problematic Unicode characters
 * that may break downstream processing.
 */
function sanitizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u00AB\u00BB]/g, '"')
    .replace(/[\u2039\u203A]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u00A0]/g, ' ');
}

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

    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate URL to prevent SSRF
    const urlValidation = validateUrl(url);
    if (!urlValidation.valid) {
      return NextResponse.json(
        { success: false, error: urlValidation.error },
        { status: 400 }
      );
    }

    console.log('[scrape-url-enhanced] Scraping with Firecrawl:', url);

    const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
    if (!FIRECRAWL_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'Scraping service is not configured.' },
        { status: 503 }
      );
    }

    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html', 'screenshot'],
        waitFor: 3000,
        timeout: 30000,
        blockAds: true,
        maxAge: 3600000,
        actions: [
          { type: 'wait', milliseconds: 2000 },
          { type: 'screenshot', fullPage: false },
        ],
      }),
    });

    if (!firecrawlResponse.ok) {
      const errorText = await firecrawlResponse.text();
      console.error('[scrape-url-enhanced] Firecrawl API error:', errorText);
      return NextResponse.json(
        { success: false, error: 'Failed to scrape the requested URL.' },
        { status: 502 }
      );
    }

    const data = await firecrawlResponse.json();

    if (!data.success || !data.data) {
      return NextResponse.json(
        { success: false, error: 'Failed to scrape content.' },
        { status: 502 }
      );
    }

    const { markdown, metadata, screenshot, actions } = data.data;
    const screenshotUrl = screenshot || actions?.screenshots?.[0] || null;
    const sanitizedMarkdown = sanitizeQuotes(markdown || '');
    const title = metadata?.title || '';
    const description = metadata?.description || '';

    const formattedContent = `
Title: ${sanitizeQuotes(title)}
Description: ${sanitizeQuotes(description)}
URL: ${url}

Main Content:
${sanitizedMarkdown}
    `.trim();

    return NextResponse.json({
      success: true,
      url,
      content: formattedContent,
      screenshot: screenshotUrl,
      structured: {
        title: sanitizeQuotes(title),
        description: sanitizeQuotes(description),
        content: sanitizedMarkdown,
        url,
        screenshot: screenshotUrl,
      },
      metadata: {
        scraper: 'firecrawl-enhanced',
        timestamp: new Date().toISOString(),
        contentLength: formattedContent.length,
        cached: data.data.cached || false,
        ...metadata,
      },
    });
  } catch (error) {
    console.error('[scrape-url-enhanced] Error:', error);
    return NextResponse.json(
      { success: false, error: 'An error occurred while scraping.' },
      { status: 500 }
    );
  }
}
