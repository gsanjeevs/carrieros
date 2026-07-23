// src/lib/api.ts
// Calls carrieros-web's Next.js API routes — needed for endpoints that are
// real business logic (role/tier gating, language inheritance, etc.), not
// a plain table read/write RLS already covers. lib/supabase.ts's own header
// comment already documents this seam: "API routes that need this session
// read it from an Authorization: Bearer <token> header." This is the first
// real call site.
import { supabase } from '@/lib/supabase'

const API_URL = process.env.EXPO_PUBLIC_API_URL!

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`)
  }
  return fetch(`${API_URL}${path}`, { ...init, headers })
}
