import Image from 'next/image';
import type { PublishedMedia } from '@ocall/shared';

const PUBLIC_MEDIA = '/api/v1/public/media/';

/**
 * Image d'un site vitrine. Image PUBLIÉE : optimisée par Next.js (taille adaptée à l'écran,
 * AVIF/WebP, chargement différé sauf `priority`). Aperçu du brouillon (route authentifiée) :
 * balise simple, non optimisée — l'optimiseur n'a pas la session de l'éditeur.
 */
export function SiteImage({
  media,
  sizes,
  className,
  priority = false,
  fill = false,
  alt,
}: {
  media: PublishedMedia;
  sizes: string;
  className?: string;
  priority?: boolean;
  fill?: boolean;
  alt?: string;
}) {
  const text = alt ?? media.alt;
  if (media.url.startsWith(PUBLIC_MEDIA)) {
    return fill ? (
      <Image
        src={media.url}
        alt={text}
        fill
        sizes={sizes}
        priority={priority}
        className={className}
      />
    ) : (
      <Image
        src={media.url}
        alt={text}
        width={media.width}
        height={media.height}
        sizes={sizes}
        priority={priority}
        className={className}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={media.url}
      alt={text}
      width={fill ? undefined : media.width}
      height={fill ? undefined : media.height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={fill ? `absolute inset-0 h-full w-full ${className ?? ''}` : className}
    />
  );
}
