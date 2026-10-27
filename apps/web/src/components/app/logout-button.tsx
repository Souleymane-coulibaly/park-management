'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { api } from '@/lib/api';

export function LogoutButton({ className = '' }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        router.replace('/connexion');
        router.refresh();
      }}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${className}`}
    >
      <LogOut className="h-4 w-4" aria-hidden />
      Déconnexion
    </button>
  );
}
