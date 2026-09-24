'use client'
// components/MessageInbox.tsx
// Dispatcher/owner-facing aggregate message inbox list — presentational
// only, receives conversation summaries as plain props (server/composition.ts's
// createConversationService(...).list(actor) result, read in-process per
// ADR 0003). Visual conventions (dark surfaces, muted secondary text,
// brand-orange accents) mirror DriverMessageThread.tsx's chat styling, even
// though this is a list view rather than a thread view.
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { formatDateTime, type DateTimePrefs } from '@/lib/format-datetime'
import { Card, EmptyState, StatusBadge, Table, TableCell, TableHeaderCell, TableRow } from '@/components/ui'

export interface ConversationSummaryProps {
  loadId: number
  loadNumber: string
  lastMessageBody: string
  lastMessageAt: string
  unreadCount: number
}

const PREVIEW_MAX_LENGTH = 100

function truncate(body: string): string {
  if (body.length <= PREVIEW_MAX_LENGTH) return body
  return `${body.slice(0, PREVIEW_MAX_LENGTH).trimEnd()}…`
}

export default function MessageInbox({
  conversations,
  dateTimePrefs,
}: {
  conversations: readonly ConversationSummaryProps[]
  dateTimePrefs?: DateTimePrefs
}) {
  const t = useTranslations('messages')

  if (conversations.length === 0) {
    return (
      <Card>
        <EmptyState icon="forum" title={t('emptyTitle')} description={t('emptyDescription')} />
      </Card>
    )
  }

  return (
    <Card>
      <Table>
        <thead>
          <TableRow>
            <TableHeaderCell>{t('columnLoad')}</TableHeaderCell>
            <TableHeaderCell>{t('columnLastMessage')}</TableHeaderCell>
            <TableHeaderCell>{t('columnUpdated')}</TableHeaderCell>
            <TableHeaderCell numeric>{t('columnUnread')}</TableHeaderCell>
          </TableRow>
        </thead>
        <tbody>
          {conversations.map((conversation) => (
            <TableRow key={conversation.loadId}>
              <TableCell>
                <Link
                  href={`/loads/${conversation.loadNumber}`}
                  className="text-text-pri font-medium hover:text-brand-orange transition-colors"
                >
                  {conversation.loadNumber}
                </Link>
              </TableCell>
              <TableCell>
                <span className="text-text-sec">{truncate(conversation.lastMessageBody)}</span>
              </TableCell>
              <TableCell>
                <span className="text-text-mut whitespace-nowrap">
                  {formatDateTime(conversation.lastMessageAt, dateTimePrefs)}
                </span>
              </TableCell>
              <TableCell numeric>
                {conversation.unreadCount > 0 && (
                  <StatusBadge variant="brand" size="sm">
                    {conversation.unreadCount}
                  </StatusBadge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>
    </Card>
  )
}
