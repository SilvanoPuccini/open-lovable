import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { validateCommand, checkRateLimit, getClientId } from '@/lib/security';

declare global {
  var activeSandboxProvider: any;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientId = getClientId(request);
    const rateCheck = checkRateLimit(`run-command-v2:${clientId}`, 20, 60_000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rateCheck.resetMs / 1000)) } }
      );
    }

    const { command } = await request.json();

    // Validate command against whitelist
    const validation = validateCommand(command);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const provider = sandboxManager.getActiveProvider() || global.activeSandboxProvider;

    if (!provider) {
      return NextResponse.json(
        { success: false, error: 'No active sandbox' },
        { status: 400 }
      );
    }

    console.log(`[run-command-v2] Executing: ${validation.cmd} ${validation.args?.join(' ')}`);

    const result = await provider.runCommand(command);

    return NextResponse.json({
      success: result.success,
      output: result.stdout,
      error: result.stderr,
      exitCode: result.exitCode,
      message: result.success ? 'Command executed successfully' : 'Command failed',
    });
  } catch (error) {
    console.error('[run-command-v2] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Command execution failed.' },
      { status: 500 }
    );
  }
}
