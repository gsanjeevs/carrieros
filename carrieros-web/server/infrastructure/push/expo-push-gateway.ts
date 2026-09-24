// server/infrastructure/push/expo-push-gateway.ts
// Thin adapter over lib/send-push.ts's real Expo push send for the
// PushNotificationGateway port. Kept out of server/application (dependency-free
// per Rule D) and out of server/domain (pure, no I/O).
import { sendPushNotification } from '@/lib/send-push'
import type { PushNotificationGateway } from '../../ports'

export class ExpoPushGateway implements PushNotificationGateway {
  async send(input: { readonly to: string; readonly title: string; readonly body: string; readonly data: Record<string, unknown> }): Promise<void> {
    await sendPushNotification(input)
  }
}
