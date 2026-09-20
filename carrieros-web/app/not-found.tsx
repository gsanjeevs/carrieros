import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui'

export default async function NotFound() {
  const t = await getTranslations('errorPage')
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-xl font-bold text-text-pri">{t('notFoundTitle')}</h1>
      <p className="text-sm text-text-sec">{t('notFoundBody')}</p>
      <Link href="/dashboard">
        <Button type="button">{t('home')}</Button>
      </Link>
    </div>
  )
}
