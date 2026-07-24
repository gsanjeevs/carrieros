'use client'
// app/(app)/dispatch/DispatchQueueRow.tsx
// Dedicated one-tap dispatch flow (mockup-02) — the audit's High gap was
// that /dispatch reused the mockup's name for an unrelated live-map feature
// with no assign-driver screen of its own. Rather than duplicate the
// assignment logic, this wraps the existing components/DispatchPanel.tsx
// (already the real avatar-card driver/vehicle picker + default-vehicle
// auto-fill, used today on the load detail page) in a Modal so a dispatcher
// never has to leave the queue to assign a load — same component, same
// PATCH /api/loads/[id] call, just reachable in one tap instead of a
// page navigation.
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Modal, StatusBadge } from '@/components/ui'
import { loadStatusVariant, type LoadStatus } from '@/lib/domain/load-status'
import DispatchPanel from '@/components/DispatchPanel'

export default function DispatchQueueRow({
  loadId,
  loadNumber,
  status,
  customerName,
  driverId,
  vehicleId,
  orgId,
}: {
  loadId: number
  loadNumber: string
  status: string
  customerName: string | null
  driverId: number | null
  vehicleId: number | null
  orgId: number
}) {
  const t = useTranslations('dispatch')
  const tLoads = useTranslations('loads')
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-subtle transition-colors duration-150 text-left"
      >
        <div className="min-w-0">
          <p className="text-text-pri text-sm font-medium truncate">{loadNumber}</p>
          <p className="text-text-mut text-xs truncate">{customerName ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge variant={loadStatusVariant((status ?? 'draft') as LoadStatus)} size="sm">
            {tLoads(`status_${status ?? 'draft'}` as never)}
          </StatusBadge>
          <span className="text-xs font-semibold text-brand-orange">{t('dispatchAction')}</span>
        </div>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('dispatchModalTitle', { loadNumber })}
        footer={<></>}
      >
        <DispatchPanel
          loadId={loadId}
          loadNumber={loadNumber}
          currentStatus={status}
          currentDriverId={driverId}
          currentVehicleId={vehicleId}
          orgId={orgId}
        />
      </Modal>
    </>
  )
}
