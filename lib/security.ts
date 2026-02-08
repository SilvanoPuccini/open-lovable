/**
 * Security utilities for the Open Lovable application.
 * Provides input validation, sanitization, and protection against common attacks.
 */

// ---------------------------------------------------------------------------
// URL Validation (Anti-SSRF)
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal',
  '169.254.169.254', // AWS/GCP metadata endpoint
]);

const BLOCKED_HOSTNAME_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,          // 10.x.x.x
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16-31.x.x
  /^192\.168\.\d{1,3}\.\d{1,3}$/,               // 192.168.x.x
  /^fc[0-9a-f]{2}:/i,                           // IPv6 ULA
  /^fe80:/i,                                     // IPv6 link-local
];

/**
 * Validates a URL to prevent SSRF attacks.
 * Only allows http/https protocols and blocks internal/private network addresses.
 */
export function validateUrl(input: string): { valid: boolean; url?: URL; error?: string } {
  try {
    const url = new URL(input);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: `Invalid protocol: ${url.protocol}. Only http and https are allowed.` };
    }

    const hostname = url.hostname.toLowerCase();

    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return { valid: false, error: 'Internal/localhost URLs are not allowed.' };
    }

    for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, error: 'Private network URLs are not allowed.' };
      }
    }

    return { valid: true, url };
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
}

// ---------------------------------------------------------------------------
// Command Whitelist (Anti Command-Injection)
// ---------------------------------------------------------------------------

/**
 * Allowed commands that can be executed in the sandbox.
 * Any command not in this list will be rejected.
 */
const ALLOWED_COMMANDS = new Set([
  'npm',
  'npx',
  'node',
  'cat',
  'ls',
  'pwd',
  'mkdir',
  'find',
  'echo',
  'cp',
  'mv',
  'rm',
  'head',
  'tail',
  'wc',
  'grep',
  'which',
  'env',
  'vite',
  'tsc',
  'eslint',
  'prettier',
]);

/**
 * Blocked arguments/patterns that should never appear in commands.
 */
const BLOCKED_PATTERNS = [
  /[;&|`$]/,           // Shell metacharacters
  /\.\.\//,            // Path traversal
  /\/etc\//,           // System files
  /\/proc\//,          // Proc filesystem
  /\/sys\//,           // Sys filesystem
  /\bsudo\b/,          // Privilege escalation
  /\bcurl\b/,          // Network calls (use API routes instead)
  /\bwget\b/,          // Network calls
  /\bchmod\b/,         // Permission changes
  /\bchown\b/,         // Ownership changes
  /\bdd\b/,            // Disk operations
  /\bmkfs\b/,          // Filesystem creation
  /\bkill\b/,          // Process killing (use dedicated endpoints)
  /\bpkill\b/,         // Process killing
  /\breboot\b/,        // System reboot
  /\bshutdown\b/,      // System shutdown
];

/**
 * Validates a command string against the whitelist.
 * Returns the parsed command parts if valid, or an error message.
 */
export function validateCommand(command: string): {
  valid: boolean;
  cmd?: string;
  args?: string[];
  error?: string;
} {
  if (!command || typeof command !== 'string') {
    return { valid: false, error: 'Command is required and must be a string.' };
  }

  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Command cannot be empty.' };
  }

  if (trimmed.length > 2000) {
    return { valid: false, error: 'Command exceeds maximum length (2000 characters).' };
  }

  // Check for blocked patterns in the full command
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: `Command contains blocked pattern: ${pattern.source}` };
    }
  }

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  if (!ALLOWED_COMMANDS.has(cmd)) {
    return { valid: false, error: `Command '${cmd}' is not allowed. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}` };
  }

  return { valid: true, cmd, args };
}

// ---------------------------------------------------------------------------
// Package Name Validation
// ---------------------------------------------------------------------------

/**
 * Validates npm package names to prevent injection.
 * Based on npm naming rules: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#name
 */
const VALID_PACKAGE_PATTERN = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[\w.^~>=<|-]+)?$/;

export function validatePackageName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 214) return false;
  return VALID_PACKAGE_PATTERN.test(trimmed);
}

/**
 * Validates and sanitizes an array of package names.
 * Returns only valid package names.
 */
export function sanitizePackageList(packages: unknown): {
  valid: string[];
  invalid: string[];
} {
  if (!Array.isArray(packages)) {
    return { valid: [], invalid: [] };
  }

  const valid: string[] = [];
  const invalid: string[] = [];

  const seen = new Set<string>();

  for (const pkg of packages) {
    if (typeof pkg !== 'string') {
      invalid.push(String(pkg));
      continue;
    }

    const trimmed = pkg.trim();
    if (seen.has(trimmed)) continue; // deduplicate
    seen.add(trimmed);

    if (validatePackageName(trimmed)) {
      valid.push(trimmed);
    } else {
      invalid.push(trimmed);
    }
  }

  return { valid, invalid };
}

// ---------------------------------------------------------------------------
// Safe Error Responses
// ---------------------------------------------------------------------------

/**
 * Creates a safe error response that doesn't leak stack traces or internal details.
 */
export function safeErrorResponse(error: unknown, context: string): {
  error: string;
  context: string;
} {
  if (error instanceof Error) {
    return {
      error: error.message,
      context,
    };
  }

  return {
    error: 'An unexpected error occurred.',
    context,
  };
}

// ---------------------------------------------------------------------------
// Rate Limiting (Simple in-memory)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Simple in-memory rate limiter.
 * In production, use Redis or a dedicated rate limiting service.
 *
 * @param key - Unique identifier (e.g., IP address or API route)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns Whether the request is allowed
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 30,
  windowMs: number = 60_000
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();

  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  const remaining = Math.max(0, maxRequests - entry.timestamps.length);
  const oldestInWindow = entry.timestamps[0] || now;
  const resetMs = oldestInWindow + windowMs - now;

  if (entry.timestamps.length >= maxRequests) {
    return { allowed: false, remaining: 0, resetMs };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: remaining - 1, resetMs };
}

// Periodically clean up old rate limit entries (every 5 minutes)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < 300_000);
      if (entry.timestamps.length === 0) {
        rateLimitStore.delete(key);
      }
    }
  }, 300_000);
}

// ---------------------------------------------------------------------------
// Path Validation
// ---------------------------------------------------------------------------

/**
 * Validates and normalizes a file path within the sandbox.
 * Prevents path traversal attacks.
 */
export function validateSandboxPath(
  path: string,
  allowedBase: string = '/home/user/app'
): { valid: boolean; normalizedPath?: string; error?: string } {
  if (!path || typeof path !== 'string') {
    return { valid: false, error: 'Path is required.' };
  }

  // Block obvious traversal attempts
  if (path.includes('..')) {
    return { valid: false, error: 'Path traversal is not allowed.' };
  }

  // Block null bytes
  if (path.includes('\0')) {
    return { valid: false, error: 'Null bytes are not allowed in paths.' };
  }

  // Normalize and ensure it stays within the allowed base
  const fullPath = path.startsWith('/') ? path : `${allowedBase}/${path}`;

  // Simple check: ensure the resolved path starts with the allowed base
  // (In a real scenario, use path.resolve and compare)
  if (!fullPath.startsWith(allowedBase) && !fullPath.startsWith('/vercel/sandbox')) {
    return { valid: false, error: `Path must be within ${allowedBase} or /vercel/sandbox.` };
  }

  return { valid: true, normalizedPath: fullPath };
}

// ---------------------------------------------------------------------------
// Input Validation Helpers
// ---------------------------------------------------------------------------

/**
 * Validates that a value is a non-empty string within length bounds.
 */
export function validateString(
  value: unknown,
  fieldName: string,
  maxLength: number = 10_000
): { valid: boolean; value?: string; error?: string } {
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string.` };
  }

  if (value.trim().length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty.` };
  }

  if (value.length > maxLength) {
    return { valid: false, error: `${fieldName} exceeds maximum length (${maxLength}).` };
  }

  return { valid: true, value: value.trim() };
}

/**
 * Extracts the client identifier from a request for rate limiting.
 */
export function getClientId(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}
