'use client'
// app/(app)/loads/[load_number]/PostToDatButton.tsx
// Load-detail "Post to DAT" action (migration 0052, Phase 1 -- posting only, mocked DAT client).
// Same "button component that calls an API route and refreshes" shape as CreateInvoiceButton.tsx in
// this directory, but calls the /api/v1 route directly (fetch) rather than a server action, since
// this capability is also reachable as a standalone API operation (registered in
// server/contract/endpoints.ts) unlike invoices' plain-RLS-CRUD posture (decisions.md R3b).
//
// Renders one of two states:
//   - already posted -> the external posting id, no button (loadboard_postings_load_provider_unique
//     would reject a second post anyway)
//   - not yet posted  -> a button that POSTs and shows the returned posting id on success
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardHeader, CardBody, Button } from '@/components/ui'

interface ExistingPosting {
  externalPostingId: string
  postedAt: string
}

export default function PostToDatButton({
  loadId,
  existingPosting,
}: {
  loadId: number
  existingPosting: ExistingPosting | null
}) {
  const router = useRouter()
  const t = useTranslations('loadboard')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [posted, setPosted] = useState<ExistingPosting | null>(existingPosting)

  function friendly(code?: string) {
    try {
      return tErrors(code as never)
    } catch {
      return tErrors('SERVER_ERROR')
    }
  }

  if (posted) {
    return (
      <Card>
        <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('title')}</h2></CardHeader>
        <CardBody>
          <p className="text-text-sec text-sm mb-1">{t('alreadyPosted')}</p>
          <code className="block bg-surface-subtle border border-border-ui rounded-lg px-3 py-2 text-xs font-mono text-text-pri break-all mt-2">
            {posted.externalPostingId}
          </code>
        </CardBody>
      </Card>
    )
  }

  function post() {
    setError('')
    startTransition(async () => {
      try {
        const res = await fetch(`/api/v1/loads/${loadId}/loadboard-postings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'dat' }),
        })
        const json = await res.json()
        if (!res.ok) {
          setError(friendly(json.error_code))
          return
        }
        setPosted({ externalPostingId: json.posting.external_posting_id, postedAt: json.posting.posted_at })
        router.refresh()
      } catch {
        setError(tCommon('somethingWentWrong'))
      }
    })
  }

  return (
    <Card>
      <CardHeader><h2 className="text-text-pri font-medium text-sm">{t('title')}</h2></CardHeader>
      <CardBody>
        <p className="text-text-sec text-sm mb-3">{t('description')}</p>
        <Button onClick={post} disabled={pending} loading={pending} className="w-full py-2.5">
          <span className="material-symbols-outlined text-[18px]">campaign</span>
          {pending ? t('posting') : t('postButton')}
        </Button>
        {error && (
          <div className="mt-3 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2.5 text-danger text-xs">
            {error}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
