/**
 * Supabase database client module.
 *
 * Provides a singleton Supabase client for server-side database operations.
 * Falls back gracefully when no Supabase URL is configured, allowing
 * the app to run without a database in development.
 *
 * Setup:
 * 1. Create a Supabase project at https://supabase.com
 * 2. Run the schema SQL in Supabase SQL Editor (lib/db/schema.sql)
 * 3. Add environment variables:
 *    - NEXT_PUBLIC_SUPABASE_URL: Your Supabase project URL
 *    - SUPABASE_SERVICE_ROLE_KEY: Service role key (server-side only)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── Type definitions for database records ───────────────────────────────────

export interface Conversation {
  id: string;
  user_id: string | null;
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
  user_id: string | null;
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

// ─── Supabase client singleton ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabaseClient: SupabaseClient<any> | null = null;

/**
 * Get the Supabase client instance (singleton).
 * Returns null if Supabase is not configured.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabase(): SupabaseClient<any> | null {
  if (supabaseClient) return supabaseClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  supabaseClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}

/**
 * Check if Supabase is configured.
 */
export function isDatabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Get database connection status.
 */
export function getDbStatus(): {
  configured: boolean;
  provider: string;
} {
  return {
    configured: isDatabaseConfigured(),
    provider: isDatabaseConfigured() ? 'supabase' : 'none',
  };
}

// ─── Conversation helpers ────────────────────────────────────────────────────

/**
 * Save or update a conversation in Supabase.
 */
export async function upsertConversation(
  conversationId: string,
  data: {
    title?: string | null;
    metadata?: Record<string, unknown>;
    user_id?: string | null;
  }
): Promise<Conversation | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: row, error } = await supabase
    .from('conversations')
    .upsert(
      {
        id: conversationId,
        title: data.title ?? null,
        metadata: data.metadata ?? {},
        user_id: data.user_id ?? null,
      },
      { onConflict: 'id' }
    )
    .select()
    .single();

  if (error) {
    console.error('[db] Error upserting conversation:', error.message);
    return null;
  }
  return row as Conversation;
}

/**
 * Get a conversation by ID.
 */
export async function getConversation(
  conversationId: string
): Promise<Conversation | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: row, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    console.error('[db] Error getting conversation:', error.message);
    return null;
  }
  return row as Conversation;
}

/**
 * List recent conversations.
 */
export async function listConversations(
  limit = 20
): Promise<Conversation[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data: rows, error } = await supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[db] Error listing conversations:', error.message);
    return [];
  }
  return (rows ?? []) as Conversation[];
}

/**
 * Delete a conversation and its messages (cascade).
 */
export async function deleteConversation(
  conversationId: string
): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);

  if (error) {
    console.error('[db] Error deleting conversation:', error.message);
    return false;
  }
  return true;
}

// ─── Message helpers ─────────────────────────────────────────────────────────

/**
 * Add a message to a conversation.
 */
export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata?: Record<string, unknown>
): Promise<Message | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: row, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      metadata: metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    console.error('[db] Error adding message:', error.message);
    return null;
  }
  return row as Message;
}

/**
 * Get messages for a conversation.
 */
export async function getMessages(
  conversationId: string,
  limit = 50
): Promise<Message[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data: rows, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[db] Error getting messages:', error.message);
    return [];
  }
  return (rows ?? []) as Message[];
}
