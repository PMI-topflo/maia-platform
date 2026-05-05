import { NextRequest, NextResponse } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

// Login paths per persona — staff uses its own login page, others use the homepage
const PROTECTED: Record<string, { persona: 'owner' | 'board' | 'staff' | 'unit_manager' | 'building_manager'; loginPath: string }> = {
  '/my-account':       { persona: 'owner',            loginPath: '/' },
  '/board':            { persona: 'board',            loginPath: '/' },
  '/admin':            { persona: 'staff',            loginPath: '/admin/login' },
  '/unit-manager':     { persona: 'unit_manager',     loginPath: '/' },
  '/building-manager': { persona: 'building_manager', loginPath: '/' },
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Staff login page is always public — never intercept it or an infinite loop results
  if (pathname === '/admin/login') return NextResponse.next()

  const match = Object.entries(PROTECTED).find(([prefix]) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
  if (!match) return NextResponse.next()
  const [, route] = match

  const token   = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySession(token) : null

  if (!session) {
    const dest = req.nextUrl.clone()
    dest.pathname = route.loginPath
    dest.search   = ''
    // Owner/board: pass ?return= so the homepage can resume the user's original destination
    if (route.loginPath === '/') {
      dest.searchParams.set('return', pathname + req.nextUrl.search)
    }
    return NextResponse.redirect(dest)
  }

  // Staff can access any protected route; other personas must match exactly
  if (session.persona !== 'staff' && session.persona !== route.persona) {
    const dest = req.nextUrl.clone()
    dest.pathname = '/'
    dest.search   = ''
    return NextResponse.redirect(dest)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/my-account/:path*',
    '/board/:path*',
    '/unit-manager/:path*',
    '/building-manager/:path*',
  ],
}
