import { getTranslations } from 'next-intl/server'

export default async function MyLoadsPage() {
  const t = await getTranslations('loads')
  const tCommon = await getTranslations('common')
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">{t('myLoadsTitle')}</h1>
      <p className="text-slate-400 mt-2 text-sm">{tCommon('comingSoon')}</p>
    </div>
  )
}
