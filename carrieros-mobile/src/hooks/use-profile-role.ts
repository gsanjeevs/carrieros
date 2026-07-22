// src/hooks/use-profile-role.ts
// Resolves the signed-in user's profiles.role once per session — the
// single source of truth AppTabs (and every role-branching screen added
// alongside it) uses to decide which tab set / content to render. Same
// query shape as the one previously inlined in (tabs)/index.tsx and
// load/[id].tsx; centralized here so those screens and the tab bar don't
// each re-derive it slightly differently.
import { useEffect, useState } from 'react';

import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

export type Role = 'owner' | 'solo' | 'driver' | 'dispatcher' | 'finance';

export function useProfileRole() {
  const { session } = useSession();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!session?.user.id) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      if (cancelled) return;
      // 'solo' fallback matches the pre-existing default in (tabs)/index.tsx.
      setRole((data?.role as Role) ?? 'solo');
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  return { role, loading };
}
