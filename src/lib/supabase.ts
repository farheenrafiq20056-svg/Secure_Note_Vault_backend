/**
 * Supabase Backend Authentication Client
 * 
 * Provides lazy initialization for Supabase admin and auth services.
 * Follows zero-crash graceful initialization if keys are not yet configured.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;
let supabaseAdminClient: SupabaseClient | null = null;

export function getSupabaseConfig(): {
  url: string | null;
  anonKey: string | null;
  serviceRoleKey: string | null;
  isConfigured: boolean;
} {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

  return {
    url,
    anonKey,
    serviceRoleKey,
    isConfigured: Boolean(url && (anonKey || serviceRoleKey))
  };
}

export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return supabaseClient;
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config.url) {
    return null;
  }

  const keyToUse = config.serviceRoleKey || config.anonKey;
  if (!keyToUse) {
    return null;
  }

  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(config.url, keyToUse, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return supabaseAdminClient;
}
