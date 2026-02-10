import { NextRequest, NextResponse } from 'next/server';
import type { ConversationState } from '@/types/conversation';
import {
  upsertConversation,
  getConversation,
  addMessage,
  getMessages,
  deleteConversation,
  isDatabaseConfigured,
} from '@/lib/db';

declare global {
  var conversationState: ConversationState | null;
}

/**
 * Sync in-memory state to Supabase (fire-and-forget).
 * Keeps global.conversationState as fast cache while persisting to DB.
 */
async function syncToSupabase(state: ConversationState): Promise<void> {
  if (!isDatabaseConfigured()) return;

  try {
    // Upsert the conversation record
    await upsertConversation(state.conversationId, {
      title: state.context.currentTopic ?? null,
      metadata: {
        startedAt: state.startedAt,
        lastUpdated: state.lastUpdated,
        edits: state.context.edits,
        projectEvolution: state.context.projectEvolution,
        userPreferences: state.context.userPreferences,
      },
    });

    // Save new messages that may not be in DB yet
    const dbMessages = await getMessages(state.conversationId, 100);
    const dbMessageCount = dbMessages.length;
    const memMessages = state.context.messages;

    // Only add messages that are newer than what's in DB
    if (memMessages.length > dbMessageCount) {
      const newMessages = memMessages.slice(dbMessageCount);
      for (const msg of newMessages) {
        await addMessage(
          state.conversationId,
          msg.role,
          msg.content,
          msg.metadata
        );
      }
    }
  } catch (error) {
    console.error('[conversation-state] Supabase sync error:', error);
  }
}

/**
 * Load conversation from Supabase into memory.
 */
async function loadFromSupabase(
  conversationId: string
): Promise<ConversationState | null> {
  if (!isDatabaseConfigured()) return null;

  try {
    const conv = await getConversation(conversationId);
    if (!conv) return null;

    const messages = await getMessages(conversationId, 50);
    const metadata = (conv.metadata ?? {}) as Record<string, unknown>;

    return {
      conversationId: conv.id,
      startedAt: (metadata.startedAt as number) ?? Date.parse(conv.created_at),
      lastUpdated:
        (metadata.lastUpdated as number) ?? Date.parse(conv.updated_at),
      context: {
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: Date.parse(m.created_at),
          metadata: m.metadata as Record<string, unknown> | undefined,
        })),
        edits: (metadata.edits as ConversationState['context']['edits']) ?? [],
        currentTopic: conv.title ?? undefined,
        projectEvolution: (metadata.projectEvolution as ConversationState['context']['projectEvolution']) ?? {
          majorChanges: [],
        },
        userPreferences: (metadata.userPreferences as ConversationState['context']['userPreferences']) ?? {},
      },
    };
  } catch (error) {
    console.error('[conversation-state] Supabase load error:', error);
    return null;
  }
}

// GET: Retrieve current conversation state
export async function GET() {
  try {
    if (!global.conversationState) {
      return NextResponse.json({
        success: true,
        state: null,
        message: 'No active conversation',
        persistence: isDatabaseConfigured() ? 'supabase' : 'memory',
      });
    }

    return NextResponse.json({
      success: true,
      state: global.conversationState,
      persistence: isDatabaseConfigured() ? 'supabase' : 'memory',
    });
  } catch (error) {
    console.error('[conversation-state] Error getting state:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

// POST: Reset or update conversation state
export async function POST(request: NextRequest) {
  try {
    const { action, data } = await request.json();

    switch (action) {
      case 'reset': {
        const conversationId = `conv-${Date.now()}`;
        global.conversationState = {
          conversationId,
          startedAt: Date.now(),
          lastUpdated: Date.now(),
          context: {
            messages: [],
            edits: [],
            projectEvolution: { majorChanges: [] },
            userPreferences: {},
          },
        };

        // Persist to Supabase
        syncToSupabase(global.conversationState);

        console.log('[conversation-state] Reset conversation state');

        return NextResponse.json({
          success: true,
          message: 'Conversation state reset',
          state: global.conversationState,
          persistence: isDatabaseConfigured() ? 'supabase' : 'memory',
        });
      }

      case 'load': {
        // Load a specific conversation from Supabase
        const convId = data?.conversationId;
        if (!convId) {
          return NextResponse.json(
            { success: false, error: 'conversationId required for load' },
            { status: 400 }
          );
        }

        const loaded = await loadFromSupabase(convId);
        if (!loaded) {
          return NextResponse.json(
            { success: false, error: 'Conversation not found' },
            { status: 404 }
          );
        }

        global.conversationState = loaded;
        return NextResponse.json({
          success: true,
          message: 'Conversation loaded from database',
          state: global.conversationState,
        });
      }

      case 'clear-old': {
        if (!global.conversationState) {
          global.conversationState = {
            conversationId: `conv-${Date.now()}`,
            startedAt: Date.now(),
            lastUpdated: Date.now(),
            context: {
              messages: [],
              edits: [],
              projectEvolution: { majorChanges: [] },
              userPreferences: {},
            },
          };

          syncToSupabase(global.conversationState);

          return NextResponse.json({
            success: true,
            message: 'New conversation state initialized',
            state: global.conversationState,
          });
        }

        // Keep only recent data
        global.conversationState.context.messages =
          global.conversationState.context.messages.slice(-5);
        global.conversationState.context.edits =
          global.conversationState.context.edits.slice(-3);
        global.conversationState.context.projectEvolution.majorChanges =
          global.conversationState.context.projectEvolution.majorChanges.slice(
            -2
          );

        syncToSupabase(global.conversationState);

        return NextResponse.json({
          success: true,
          message: 'Old conversation data cleared',
          state: global.conversationState,
        });
      }

      case 'update': {
        if (!global.conversationState) {
          return NextResponse.json(
            { success: false, error: 'No active conversation to update' },
            { status: 400 }
          );
        }

        if (data) {
          if (data.currentTopic) {
            global.conversationState.context.currentTopic = data.currentTopic;
          }
          if (data.userPreferences) {
            global.conversationState.context.userPreferences = {
              ...global.conversationState.context.userPreferences,
              ...data.userPreferences,
            };
          }

          global.conversationState.lastUpdated = Date.now();
        }

        // Persist to Supabase
        syncToSupabase(global.conversationState);

        return NextResponse.json({
          success: true,
          message: 'Conversation state updated',
          state: global.conversationState,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action. Use "reset", "load", "update", or "clear-old"' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[conversation-state] Error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

// DELETE: Clear conversation state
export async function DELETE() {
  try {
    // If Supabase is configured, also delete from DB
    if (global.conversationState && isDatabaseConfigured()) {
      await deleteConversation(global.conversationState.conversationId);
    }

    global.conversationState = null;

    console.log('[conversation-state] Cleared conversation state');

    return NextResponse.json({
      success: true,
      message: 'Conversation state cleared',
    });
  } catch (error) {
    console.error('[conversation-state] Error clearing state:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
