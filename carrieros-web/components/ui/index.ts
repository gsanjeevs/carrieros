// Barrel export for components/ui — the real implementation of
// ux-foundations.md §3's component catalog / carrieros-design-system.md
// §5's recipes. Import from '@/components/ui' rather than deep-importing
// individual files.

export { default as Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'

export { default as StatusBadge } from './StatusBadge'
export type { StatusBadgeProps, StatusBadgeVariant, StatusBadgeSize } from './StatusBadge'

export { default as Card, CardHeader, CardBody } from './Card'
export type { CardProps, CardVariant } from './Card'

export { default as Input } from './Input'
export type { InputProps, InputSize } from './Input'

export { default as KpiTile } from './KpiTile'
export type { KpiTileProps, KpiTileDelta, DeltaTone } from './KpiTile'

export { default as Avatar } from './Avatar'
export type { AvatarProps, AvatarVariant, AvatarSize } from './Avatar'

export { Table, TableHeaderCell, TableRow, TableCell } from './Table'
export type { TableProps, TableHeaderCellProps, TableCellProps } from './Table'

export { default as ProgressBar } from './ProgressBar'
export type { ProgressBarProps, ProgressBarVariant } from './ProgressBar'

export { default as Tabs } from './Tabs'
export type { TabsProps, TabItem } from './Tabs'

export { default as SegmentedControl } from './SegmentedControl'
export type { SegmentedControlProps, SegmentedControlItem } from './SegmentedControl'

export { default as Modal } from './Modal'
export type { ModalProps, ModalSize, ModalVariant } from './Modal'

export { default as Tooltip } from './Tooltip'
export type { TooltipProps } from './Tooltip'

export { default as Toast } from './Toast'
export type { ToastProps, ToastVariant } from './Toast'

export { default as EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { default as Skeleton } from './Skeleton'
export type { SkeletonProps, SkeletonVariant } from './Skeleton'

export { cn } from './cn'
