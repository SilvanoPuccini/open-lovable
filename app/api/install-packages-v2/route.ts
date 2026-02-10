import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { sanitizePackageList, checkRateLimit, getClientId } from '@/lib/security';

declare global {
  var activeSandboxProvider: any;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientId = getClientId(request);
    const rateCheck = checkRateLimit(`install-packages:${clientId}`, 5, 60_000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded. Try again later.' },
        { status: 429 }
      );
    }

    const { packages } = await request.json();

    if (!packages || !Array.isArray(packages) || packages.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Packages array is required'
      }, { status: 400 });
    }

    // Validate and sanitize package names
    const { valid: validPackages, invalid: invalidPackages } = sanitizePackageList(packages);

    if (invalidPackages.length > 0) {
      console.warn(`[install-packages-v2] Rejected invalid package names:`, invalidPackages);
    }

    if (validPackages.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No valid package names provided'
      }, { status: 400 });
    }

    const provider = sandboxManager.getActiveProvider() || global.activeSandboxProvider;

    if (!provider) {
      return NextResponse.json({
        success: false,
        error: 'No active sandbox'
      }, { status: 400 });
    }

    console.log(`[install-packages-v2] Installing: ${validPackages.join(', ')}`);

    const result = await provider.installPackages(validPackages);
    
    return NextResponse.json({
      success: result.success,
      output: result.stdout,
      error: result.stderr,
      message: result.success ? 'Packages installed successfully' : 'Package installation failed'
    });
    
  } catch (error) {
    console.error('[install-packages-v2] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: (error as Error).message 
    }, { status: 500 });
  }
}