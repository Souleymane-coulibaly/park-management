'use client';

import { type ReactNode, createContext, useContext } from 'react';
import type { Permission, PlatformPermission } from '@ocall/shared';
import type { Me } from '@/lib/types';

const SessionContext = createContext<Me | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession doit être utilisé dans un SessionProvider.');
  return me;
}

/**
 * Indique si le rôle courant porte une permission. Sert uniquement à l'affichage :
 * l'API applique les mêmes règles et reste la seule autorité.
 */
export function useCan(permission: Permission): boolean {
  return useSession().permissions.includes(permission);
}

/** Même principe pour les comptes internes Ocall (permissions plateforme). */
export function useCanPlatform(permission: PlatformPermission): boolean {
  return useSession().platformPermissions.includes(permission);
}
