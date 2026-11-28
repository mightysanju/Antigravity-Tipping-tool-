import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';
import { callLoginContext, setApiDevCaller } from '../lib/apiClient';
import type { AppRole, AuthSessionUser } from '../shared/types';

export type DevPersonaKey =
  | 'super_admin'
  | 'admin_paloma'
  | 'admin_harbor'
  | 'dept_manager'
  | 'staff_maria'
  | 'signed_out';

export const DEV_PERSONAS: Record<Exclude<DevPersonaKey, 'signed_out'>, AuthSessionUser> = {
  super_admin: {
    authUserId: '00000000-0000-0000-0000-000000000001',
    email: 'superadmin@frontdesktip.test',
    name: 'Platform Super Admin',
    role: 'super_admin',
    propertyId: null,
    departmentId: null,
    personId: null,
    status: 'active',
    agreementSignedAt: '2026-11-25T00:00:00Z',
  },
  admin_paloma: {
    authUserId: '00000000-0000-0000-0000-000000000010',
    email: 'admin.paloma@frontdesktip.test',
    name: 'Clara Mendez',
    role: 'property_admin',
    propertyId: '10000000-0000-0000-0000-000000000001',
    departmentId: null,
    personId: '30000000-0000-0000-0000-000000000001',
    status: 'active',
    agreementSignedAt: '2026-11-25T00:00:00Z',
  },
  admin_harbor: {
    authUserId: '00000000-0000-0000-0000-000000000020',
    email: 'admin.harbor@frontdesktip.test',
    name: 'Marcus Vance',
    role: 'property_admin',
    propertyId: '10000000-0000-0000-0000-000000000002',
    departmentId: null,
    personId: '30000000-0000-0000-0000-000000000007',
    status: 'active',
    agreementSignedAt: '2026-11-25T00:00:00Z',
  },
  dept_manager: {
    authUserId: '00000000-0000-0000-0000-000000000011',
    email: 'manager.hk@frontdesktip.test',
    name: 'Sophia Alvarez',
    role: 'dept_manager',
    propertyId: '10000000-0000-0000-0000-000000000001',
    departmentId: '20000000-0000-0000-0000-000000000001',
    personId: '30000000-0000-0000-0000-000000000002',
    status: 'active',
    agreementSignedAt: '2026-11-25T00:00:00Z',
  },
  staff_maria: {
    authUserId: '00000000-0000-0000-0000-000000000012',
    email: 'maria.garcia@frontdesktip.test',
    name: 'Maria Garcia',
    role: 'staff',
    propertyId: '10000000-0000-0000-0000-000000000001',
    departmentId: '20000000-0000-0000-0000-000000000001',
    personId: '30000000-0000-0000-0000-000000000003',
    status: 'active',
    agreementSignedAt: '2026-11-25T00:00:00Z',
  },
};

interface AuthContextValue {
  user: AuthSessionUser | null;
  loading: boolean;
  devPersona: DevPersonaKey;
  switchDevPersona: (persona: DevPersonaKey) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: false,
  devPersona: 'super_admin',
  switchDevPersona: () => {},
  signOut: async () => {},
});

function extractRoleFromClaims(claims: Record<string, unknown> | undefined): AppRole | null {
  const r = claims?.app_role;
  if (r === 'super_admin' || r === 'property_admin' || r === 'dept_manager' || r === 'staff') {
    return r;
  }
  return null;
}

const DEV_STORAGE_KEY = 'fdp_dev_persona';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [devPersona, setDevPersona] = useState<DevPersonaKey>(() => {
    if (!import.meta.env.DEV) return 'signed_out';
    const saved = window.localStorage.getItem(DEV_STORAGE_KEY) as DevPersonaKey | null;
    return saved && (saved === 'signed_out' || saved in DEV_PERSONAS) ? saved : 'super_admin';
  });

  const [user, setUser] = useState<AuthSessionUser | null>(() => {
    if (!import.meta.env.DEV) return null;
    if (devPersona === 'signed_out') return null;
    return DEV_PERSONAS[devPersona];
  });
  const [loading, setLoading] = useState(!import.meta.env.DEV);

  useEffect(() => {
    if (import.meta.env.DEV && user) {
      setApiDevCaller({ authUserId: user.authUserId, email: user.email });
    } else {
      setApiDevCaller(null);
    }
  }, [user]);

  useEffect(() => {
    let active = true;

    async function hydrateSession() {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!active) return;

        if (!session) {
          if (import.meta.env.DEV) {
            setUser(devPersona === 'signed_out' ? null : DEV_PERSONAS[devPersona]);
          } else {
            setUser(null);
          }
          setLoading(false);
          return;
        }

        let role = extractRoleFromClaims(session.user.app_metadata);
        let propertyId = (session.user.app_metadata?.property_id as string | null | undefined) ?? null;
        let departmentId = (session.user.app_metadata?.department_id as string | null | undefined) ?? null;
        let personId = (session.user.app_metadata?.person_id as string | null | undefined) ?? null;
        let displayName =
          (session.user.user_metadata?.name as string | undefined) ?? session.user.email ?? 'User';

        if (!role) {
          const ctx = await callLoginContext().catch(() => null);
          if (!active) return;
          const ctxRole = ctx?.authenticated ? extractRoleFromClaims({ app_role: ctx.role }) : null;
          if (!ctxRole) {
            setUser(null);
            setLoading(false);
            return;
          }
          role = ctxRole;
          propertyId = ctx?.propertyId ?? propertyId;
          personId = ctx?.personId ?? personId;
          if (ctx?.personName) displayName = ctx.personName;
        }

        setUser({
          authUserId: session.user.id,
          email: session.user.email ?? '',
          name: displayName,
          role,
          propertyId,
          departmentId,
          personId,
          status: 'active',
          agreementSignedAt: null,
        });
      } catch {
        if (active && !import.meta.env.DEV) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    void hydrateSession();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void hydrateSession();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [devPersona]);

  function switchDevPersona(persona: DevPersonaKey) {
    if (!import.meta.env.DEV) return;
    window.localStorage.setItem(DEV_STORAGE_KEY, persona);
    setDevPersona(persona);
    setUser(persona === 'signed_out' ? null : DEV_PERSONAS[persona]);
  }

  async function signOut() {
    await supabase.auth.signOut().catch(() => {});
    if (import.meta.env.DEV) {
      window.localStorage.setItem(DEV_STORAGE_KEY, 'signed_out');
      setDevPersona('signed_out');
    }
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, devPersona, switchDevPersona, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
