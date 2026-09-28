'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function TrackingRefresh() {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(timer)
  }, [router])
  return null
}
