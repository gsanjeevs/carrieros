'use client'
// app/(app)/loads/new/CopyIntakeEmailButton.tsx
import { useState } from 'react'
import { useTranslations } from 'next-intl'

export default function CopyIntakeEmailButton({ email }: { email: string }) {
  const t = useTranslations('common')
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(email)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-slate-400 hover:text-white text-xs font-medium transition shrink-0"
    >
      <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
      {copied ? t('copied') : t('copy')}
    </button>
  )
}
