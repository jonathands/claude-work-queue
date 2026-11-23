export type QueueLine = { kind: 'group' | 'item' | 'sub'; text: string }
export type QueueView = { lines: QueueLine[]; readAt: number; error: string }
export type QueueUi = { tab: string; query: string; copied: string }

declare module 'claude-code' {
  interface PluginState {
    'work-queue': { view: Shaped<QueueView>; ui: Shaped<QueueUi> }
  }
}
