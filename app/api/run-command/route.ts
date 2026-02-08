import { NextRequest, NextResponse } from 'next/server';
import { validateCommand, checkRateLimit, getClientId } from '@/lib/security';

declare global {
  // eslint-disable-next-line no-var
  var activeSandbox: any;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const clientId = getClientId(request);
    const rateCheck = checkRateLimit(`run-command:${clientId}`, 20, 60_000);
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

    if (!global.activeSandbox) {
      return NextResponse.json(
        { success: false, error: 'No active sandbox' },
        { status: 400 }
      );
    }

    console.log(`[run-command] Executing: ${validation.cmd} ${validation.args?.join(' ')}`);

    const result = await global.activeSandbox.runCommand({
      cmd: validation.cmd,
      args: validation.args,
    });

    const stdout = await result.stdout();
    const stderr = await result.stderr();

    const output = [
      stdout ? `STDOUT:\n${stdout}` : '',
      stderr ? `\nSTDERR:\n${stderr}` : '',
      `\nExit code: ${result.exitCode}`,
    ]
      .filter(Boolean)
      .join('');

    return NextResponse.json({
      success: true,
      output,
      exitCode: result.exitCode,
      message: result.exitCode === 0 ? 'Command executed successfully' : 'Command completed with non-zero exit code',
    });
  } catch (error) {
    console.error('[run-command] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Command execution failed.' },
      { status: 500 }
    );
  }
}
