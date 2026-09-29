import { getTranslations } from 'next-intl/server'
import PasskeySettings from '@/app/(app)/settings/security/PasskeySettings'
import { Card, CardBody } from '@/components/ui'

export default async function AdminSecurityPage() {
  const t = await getTranslations('security')
  return (
    <div className="max-w-2xl p-8">
      <h1 className="text-text-pri text-xl font-semibold mb-1">{t('title')}</h1>
      <p className="text-text-sec text-sm mb-6">{t('subtitle')}</p>
      <Card><CardBody><PasskeySettings /></CardBody></Card>
    </div>
  )
}
