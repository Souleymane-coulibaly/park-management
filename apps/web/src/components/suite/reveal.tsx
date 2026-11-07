'use client';

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Apparition progressive au défilement (page d'accueil Ocall Suite).
 * - Sans JavaScript, ou si le navigateur ne connaît pas IntersectionObserver : contenu visible.
 * - `prefers-reduced-motion: reduce` : la classe `.suite-reveal` n'a aucun effet (globals.css).
 * - Une seule apparition par élément ; l'observateur est libéré ensuite.
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // Déjà à l'écran au chargement : visible immédiatement, sans masquage préalable.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) {
      setArmed(true);
      requestAnimationFrame(() => setVisible(true));
      return;
    }
    setArmed(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${armed ? 'suite-reveal' : ''} ${visible ? 'is-visible' : ''} ${className}`}
      style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
