import { NextResponse, type NextRequest } from 'next/server';

/**
 * Filtre rapide : sans cookie de session, les espaces privés redirigent vers la connexion.
 * La vérification réelle (validité, rôle, métier) est faite par l'API et les layouts serveur.
 */
export function middleware(request: NextRequest) {
  if (!request.cookies.has('ocp_session')) {
    const url = new URL('/connexion', request.url);
    url.searchParams.set('suivant', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/app/:path*', '/admin/:path*', '/changer-mot-de-passe'] };
