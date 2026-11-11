import 'server-only';
import { headers } from 'next/headers';

/**
 * En-têtes des lectures faites pour un visiteur (pages lues sans cache) : l'IP du visiteur, authentifiée
 * par le secret partagé web/API, pour que la limitation de débit de l'API compte chaque visiteur et non
 * le serveur web. Frontière de confiance explicite : WEB_TRUSTED_PROXY_HOPS proxys de confiance (edge de
 * l'hébergeur) précèdent le web ; l'IP retenue est l'entrée de X-Forwarded-For ajoutée par le plus
 * éloigné d'entre eux. Sans proxy de confiance (0, accès direct) : aucune identité transmise, l'API
 * garde l'IP de la requête — une valeur fournie par le visiteur n'est jamais signée.
 */
export async function visitorHeaders(): Promise<Record<string, string>> {
  const secret = process.env.SITES_REVALIDATE_SECRET?.trim();
  if (!secret) return {};
  const hops = Number(process.env.WEB_TRUSTED_PROXY_HOPS ?? '0');
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) return {};
  const h = await headers();
  const forwarded = (h.get('x-forwarded-for') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  // Entrées ajoutées par les proxys de confiance : les `hops` dernières ; à gauche, le visiteur peut
  // écrire ce qu'il veut. Moins d'entrées que de proxys attendus : rien n'est transmis.
  const ip = forwarded.length >= hops ? forwarded[forwarded.length - hops] : undefined;
  return ip ? { 'x-ocall-internal': secret, 'x-ocall-visitor-ip': ip } : {};
}
