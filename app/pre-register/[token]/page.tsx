// =====================================================================
// /pre-register/<token> — login-free pre-registration form for callers
// not yet in the system. MAIA texts this link; the token carries the
// caller's phone + language. Submits to /api/pre-register/<token>.
// =====================================================================

import { verifyPreregisterToken } from '@/lib/preregister-token'
import PreRegisterForm from './PreRegisterForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pre-registration — PMI Top Florida', robots: 'noindex' }

export default async function PreRegisterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const claims = await verifyPreregisterToken(token)

  return (
    <div className="min-h-screen bg-gray-50 px-4">
      {claims
        ? <PreRegisterForm token={token} phone={claims.phone} lang={claims.lang} />
        : (
          <div className="max-w-md mx-auto mt-24 bg-white border border-gray-200 rounded-xl p-6 text-center">
            <p className="text-sm text-gray-700">This link is invalid or has expired. Please call us again and we’ll send a fresh link. 🌸</p>
          </div>
        )}
    </div>
  )
}
