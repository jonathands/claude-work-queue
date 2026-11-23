import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { QueueLine, QueueUi, QueueView } from '../types'

const PANE = 'work-queue'
const TITLE = 'Work queue'

const view = atom({ plugin: 'work-queue', key: 'view' } as const, { lines: [], readAt: 0, error: '' } as QueueView, {
  shape: 'view-1',
})
const ui = atom({ plugin: 'work-queue', key: 'ui' } as const, { tab: 'active', query: '', copied: '' } as QueueUi, {
  shape: 'ui-1',
})

// Tabs: which status groups each shows.
const TABS: { key: string; label: string; short: string; match: (g: string) => boolean }[] = [
  { key: 'active', label: 'Active', short: 'Act', match: g => /^(running|coded|queued|newly)/i.test(g) },
  { key: 'running', label: 'Running', short: 'Run', match: g => /^running/i.test(g) },
  { key: 'queued', label: 'Queued', short: 'Que', match: g => /^(coded|queued|newly)/i.test(g) },
  { key: 'waiting', label: 'Waiting', short: 'Wait', match: g => /^waiting/i.test(g) },
  { key: 'done', label: 'Done', short: 'Done', match: g => /^done/i.test(g) },
  { key: 'all', label: 'All', short: 'All', match: () => true },
]

// Where the queue lives: the `planPath` option, else PLAN.md in the session's directory.
let planPath = ''
let heading = '## Work queue'

// The queue section of the plan: plain lines are status groups, "- " lines are items, indented "- " lines are notes.
export function parseQueue(text: string, head = '## Work queue'): QueueLine[] {
  const start = text.indexOf(head)
  if (start < 0) return []
  const rest = text.slice(start + head.length)
  const end = rest.search(/\n## /)
  const body = (end < 0 ? rest : rest.slice(0, end)).split(/\r?\n/).slice(1)
  const out: QueueLine[] = []
  let seenItem = false
  for (const raw of body) {
    if (!raw.trim()) continue
    if (/^\s{2,}- /.test(raw)) out.push({ kind: 'sub', text: raw.trim().slice(2) })
    else if (/^- /.test(raw)) {
      out.push({ kind: 'item', text: raw.slice(2).trim() })
      seenItem = true
    } else if (seenItem || /^[A-Z][a-z]+( [a-z(]|$)/.test(raw.trim()) && raw.trim().length < 80) {
      // A short plain line is a group; the long preamble before the first group is not.
      if (raw.trim().length < 200) out.push({ kind: 'group', text: raw.trim() })
    }
  }
  return out
}

type Item = { id: string; ref: string; title: string; detail: string }

// "Q12b. #140 login page ... (notes)" -> id Q12b, ref #140, title, detail.
export function splitItem(text: string): Item {
  let t = text
  let id = ''
  const m = /^(Q[\w+]+)[.:]?\s+/.exec(t)
  if (m) {
    id = m[1] ?? ''
    t = t.slice(m[0].length)
  }
  let detail = ''
  if (t.startsWith('(')) {
    const close = t.indexOf(') ')
    if (close > 0) {
      detail = t.slice(1, close)
      t = t.slice(close + 2)
    }
  }
  const date = /^\d{4}-\d{2}-\d{2}:\s*/.exec(t)
  if (date) t = t.slice(date[0].length)
  let ref = ''
  const r = /^(#\d+[a-z]?(?:[/+]#?\d+[a-z]?)*)\s*/.exec(t)
  if (r) {
    ref = r[1] ?? ''
    t = t.slice(r[0].length)
  }
  const open = t.indexOf(' (')
  if (open >= 16) {
    detail = detail ? detail + '; ' + t.slice(open + 2).replace(/\)\.?$/, '') : t.slice(open + 2).replace(/\)\.?$/, '')
    t = t.slice(0, open)
  }
  t = t.replace(/[.:]\s*$/, '')
  return { id, ref, title: t.charAt(0).toUpperCase() + t.slice(1), detail }
}

type Group = { name: string; items: { item: Item; notes: string[]; raw: string }[] }

function groups(lines: QueueLine[]): Group[] {
  const out: Group[] = []
  for (const l of lines) {
    if (l.kind === 'group') out.push({ name: l.text, items: [] })
    else {
      if (!out.length) out.push({ name: 'Queue', items: [] })
      const g = out[out.length - 1]!
      if (l.kind === 'item') g.items.push({ item: splitItem(l.text), notes: [], raw: l.text })
      else if (g.items.length) g.items[g.items.length - 1]!.notes.push(l.text)
    }
  }
  return out.filter(g => g.items.length)
}

type Style = { color: string; mark: string; show: number; notes: boolean }

function styleOf(name: string): Style {
  const t = name.toLowerCase()
  if (t.startsWith('running')) return { color: 'green', mark: '▶', show: 99, notes: true }
  if (t.startsWith('coded')) return { color: 'cyan', mark: '◆', show: 99, notes: false }
  if (t.startsWith('queued')) return { color: 'blue', mark: '○', show: 99, notes: false }
  if (t.startsWith('newly')) return { color: 'magenta', mark: '+', show: 99, notes: false }
  if (t.startsWith('waiting')) return { color: 'yellow', mark: '?', show: 4, notes: false }
  if (t.startsWith('done')) return { color: 'gray', mark: '✓', show: 4, notes: false }
  return { color: 'white', mark: '·', show: 99, notes: false }
}

// "Queued, in order (user, ...: ...)" -> "QUEUED, IN ORDER"
function groupTitle(name: string): string {
  const p = name.indexOf(' (')
  return (p > 0 ? name.slice(0, p) : name).toUpperCase()
}

async function refresh($: EngineInterface): Promise<void> {
  const path = planPath || (await $.session.cwd()).replace(/[\\/]$/, '') + '/PLAN.md'
  try {
    const text = await $.fs.read(path)
    const lines = parseQueue(text, heading)
    const now = await $.clock.now()
    await update($, view, old =>
      JSON.stringify(old.lines) === JSON.stringify(lines) && !old.error
        ? old
        : { lines, readAt: now, error: lines.length ? '' : `No "${heading}" section in ${path}.` },
    )
  } catch (err) {
    await update($, view, old => ({ ...old, error: `Can't read ${path}: ${String(err)}` }))
  }
}

function clock(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

export const register: Register = (on, options: PluginOptions) => {
  planPath = typeof options.planPath === 'string' ? options.planPath.trim() : ''
  if (typeof options.heading === 'string' && options.heading.trim()) heading = options.heading.trim()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'queue', description: 'Show the work queue from PLAN.md in a side pane' })
    await refresh($)
    $.clock.every(5000, () => refresh($))
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'queue' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Work queue pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const v = await read($, view)
    const u = await read($, ui)
    const cols = Math.max(24, (e.viewport?.columns ?? 48) - 2)
    const all = groups(v.lines)
    const count = (k: string) => all.filter(g => g.name.toLowerCase().startsWith(k)).reduce((n, g) => n + g.items.length, 0)
    const running = count('running')
    const queued = count('queued') + count('coded') + count('newly')
    const tab = TABS.find(t => t.key === u.tab) ?? TABS[0]!
    const q = u.query.trim().toLowerCase()
    const hit = (raw: string, notes: string[]) => !q || (raw + ' ' + notes.join(' ')).toLowerCase().includes(q)
    // A search looks in every group; otherwise the tab picks the groups.
    const gs = all
      .filter(g => q || tab.match(g.name))
      .map(g => ({ ...g, items: g.items.filter(i => hit(i.raw, i.notes)) }))
      .filter(g => g.items.length)
    const matches = gs.reduce((n, g) => n + g.items.length, 0)
    // Each tab: " Label n " with its item count; the line under them marks the open one.
    const tabCount = (t: (typeof TABS)[number]) => all.filter(g => t.match(g.name)).reduce((n, g) => n + g.items.length, 0)
    const widthOf = (xs: { label: string }[]) => xs.reduce((n, x) => n + x.label.length, 0)
    // Widest form that fits the pane: name and count, then name only, then short names.
    let tabLabels = TABS.map(t => ({ t, label: ` ${t.label} ${tabCount(t)} ` }))
    if (widthOf(tabLabels) > cols - 2) tabLabels = TABS.map(t => ({ t, label: ` ${t.label} ` }))
    if (widthOf(tabLabels) > cols - 2) tabLabels = TABS.map(t => ({ t, label: ` ${t.short} ` }))
    const idW = Math.max(4, ...all.flatMap(g => g.items.map(i => i.item.id.length))) + 1
    const rule = '─'.repeat(cols)
    const copy = async (text: string, id: string, surface: Parameters<typeof $.ui.copy>[0]['surface']) => {
      const r = await $.ui.copy({ text, surface })
      await update($, ui, o => ({ ...o, copied: r.isCopied ? `Copied ${id || 'item'}` : `Could not copy (${r.reason})` }))
      $.clock.after(3000, () => update($, ui, o => ({ ...o, copied: '' })))
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>WORK QUEUE</Text>
          <Text dimColor>
            {running} running · {queued} queued
          </Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row">
            {tabLabels.map(({ t, label }) => (
              <Box flexShrink={0}>
                <Button
                  key={'tab-' + t.key}
                  plain
                  label={label}
                  dimColor={t.key !== tab.key || !!q}
                  onPress={() => update($, ui, o => ({ ...o, tab: t.key, query: '' }))}
                />
              </Box>
            ))}
          </Box>
          <Text>
            {tabLabels.map(({ t, label }) =>
              t.key === tab.key && !q ? (
                <Text color="blue" bold>
                  {'━'.repeat(label.length)}
                </Text>
              ) : (
                <Text dimColor>{'─'.repeat(label.length)}</Text>
              ),
            )}
          </Text>
        </Box>
        <Box marginTop={1} borderStyle="round" borderColor={q ? 'blue' : undefined} borderDimColor={!q} paddingX={1} flexDirection="row">
          <Box flexShrink={0}>
            <Text color={q ? 'blue' : undefined} dimColor={!q}>
              {'⌕ '}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Input
              key="search"
              placeholder="search items and notes"
              value={u.query}
              submitLabel="filter"
              onInput={value => update($, ui, o => ({ ...o, query: value }))}
              onSubmit={value => update($, ui, o => ({ ...o, query: value }))}
            />
          </Box>
        </Box>
        {q ? (
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>
              {matches} {matches === 1 ? 'match' : 'matches'} in all groups
            </Text>
            <Button key="clear" plain label="✕ clear" onPress={() => update($, ui, o => ({ ...o, query: '' }))} />
          </Box>
        ) : null}
        {v.error ? <Text color="red">{v.error}</Text> : null}
        {gs.length === 0 && !v.error ? <Text dimColor>{q ? `Nothing matches "${u.query}".` : 'Nothing here.'}</Text> : null}
        {gs.map(g => {
          const s = styleOf(g.name)
          const shown = q ? g.items : g.items.slice(0, tab.key === 'all' || tab.key === 'active' ? s.show : 99)
          const hidden = g.items.length - shown.length
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text bold color={s.color}>
                {s.mark} {groupTitle(g.name)} <Text dimColor>({g.items.length})</Text>
              </Text>
              {shown.map(({ item, notes, raw }) => (
                <Box flexDirection="column">
                  <Box flexDirection="row">
                    <Box width={idW + 2} flexShrink={0}>
                      <Text color={s.color} bold={s.notes}>
                        {'  ' + item.id}
                      </Text>
                    </Box>
                    <Box flexShrink={1} flexGrow={1}>
                      <Button
                        key={'item-' + g.name.slice(0, 12) + '-' + (item.id || raw.slice(0, 24))}
                        plain
                        dimColor={s.color === 'gray'}
                        label={(item.ref ? item.ref + ' ' : '') + item.title}
                        onPress={press => copy(raw + (notes.length ? '\n' + notes.map(n => '  - ' + n).join('\n') : ''), item.id, press.surface)}
                      />
                    </Box>
                  </Box>
                  {s.notes
                    ? [item.detail, ...notes].filter(Boolean).map(n => (
                        <Box flexDirection="row">
                          <Box width={idW + 2} flexShrink={0}>
                            <Text> </Text>
                          </Box>
                          <Box flexShrink={1} flexGrow={1}>
                            <Text wrap="wrap" dimColor>
                              └ {n}
                            </Text>
                          </Box>
                        </Box>
                      ))
                    : null}
                </Box>
              ))}
              {hidden > 0 ? <Text dimColor>{'  '}+ {hidden} more</Text> : null}
            </Box>
          )
        })}
        <Box marginTop={1}>
          <Text dimColor>{rule}</Text>
        </Box>
        {u.copied ? <Text color="green">{u.copied}</Text> : null}
        <Text dimColor wrap="truncate-end">
          Click an item to copy it · PLAN.md read {clock(v.readAt)}
        </Text>
      </Box>
    )
  })
}
