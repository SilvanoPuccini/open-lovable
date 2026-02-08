/**
 * Database connection module for Vercel Postgres.
 *
 * This module provides a lazy connection to Vercel Postgres (powered by Neon).
 * It falls back gracefully when no database URL is configured, allowing
 * the app to run without a database in development.
 *
 * Setup:
 * 1. Create a Vercel Postgres database in your Vercel dashboard
 * 2. Link it to your project (adds POSTGRES_URL automatically)
 * 3. Run the schema: `psql $POSTGRES_URL < lib/db/schema.sql`
 *
 * Environment variables (auto-added by Vercel Postgres):
 * - POSTGRES_URL: Full connection string
 * - POSTGRES_URL_NON_POOLING: Direct connection (for migrations)
 */

// Type definitions for database records
export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface Project {
  id: string;
  conversation_id: string | null;
  name: string;
  description: string | null;
  sandbox_provider: 'e2b' | 'vercel' | null;
  sandbox_id: string | null;
  sandbox_url: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface FileSnapshot {
  id: string;
  project_id: string;
  file_path: string;
  content: string;
  version: number;
  created_at: string;
}

/**
 * Check if a database is configured.
 */
export function isDatabaseConfigured(): boolean {
  return !!process.env.POSTGRES_URL;
}

/**
 * Get the database URL for direct connections (migrations, schema changes).
 */
export function getDatabaseUrl(): string | undefined {
  return process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
}

/**
 * Placeholder for future database query function.
 * When you add @vercel/postgres, replace this with the real implementation:
 *
 * ```ts
 * import { sql } from '@vercel/postgres';
 * export { sql };
 * ```
 */
export function getDbStatus(): {
  configured: boolean;
  provider: string;
} {
  return {
    configured: isDatabaseConfigured(),
    provider: isDatabaseConfigured() ? 'vercel-postgres' : 'none',
  };
}
