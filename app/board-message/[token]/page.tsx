// =====================================================================
// /board-message/[token]
//
// Public page where a board member writes their "Message from the Board"
// for the monthly report. No login — the unguessable token is the
// authorization. Reached from the email sent by the report builder.
// =====================================================================

import { supabaseAdmin } from '@/lib/supabase-admin'
import { monthLabel } from '@/lib/monthly-report'
import BoardMessageForm from './BoardMessageForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Message from the Board — PMI Top Florida' }

export default async function BoardMessagePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const { data } = await supabaseAdmin
    .from('board_messages')
    .select('association_code, month, message, author_name')
    .eq('token', token)
    .maybeSingle()

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 px-6">
        <div className="rounded-lg bg-white px-8 py-10 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Link not valid</h1>
          <p className="mt-2 text-sm text-gray-500">
            This message link is no longer valid. Please ask PMI Top Florida Properties for a fresh link.
          </p>
        </div>
      </div>
    )
  }

  let assocName = data.association_code as string
  const { data: a } = await supabaseAdmin
    .from('associations')
    .select('association_name')
    .eq('association_code', data.association_code)
    .maybeSingle()
  if (a?.association_name) assocName = a.association_name as string

  return (
    <div className="min-h-screen bg-gray-100 py-10 px-6">
      <div className="mx-auto max-w-xl overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="bg-gradient-to-br from-[#1f2a44] to-[#0f1626] px-8 py-7">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pmi-logo-white.png" alt="PMI Top Florida Properties" className="h-9 w-auto" />
          <h1 className="mt-4 text-xl font-bold text-white">Message from the Board</h1>
          <div className="mt-1 text-sm text-[#d7dbe4]">
            {assocName} · {monthLabel(data.month as string)}
          </div>
        </div>

        <div className="px-8 py-7">
          <p className="mb-3 text-sm text-gray-600">
            {data.author_name ? `Hi ${data.author_name}, ` : ''}
            your note below appears as the <strong>&ldquo;Message from the Board&rdquo;</strong> section
            at the top of this month&apos;s management report for the community.
          </p>
          <BoardMessageForm
            token={token}
            existingMessage={(data.message as string | null) ?? ''}
          />
        </div>
      </div>
    </div>
  )
}
