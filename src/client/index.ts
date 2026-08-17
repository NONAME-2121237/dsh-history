/**
 * dsh-history client half: a dock row above the composer ("我的消息 (N)") that
 * lists EVERY message the human sent in the current session — the full log,
 * including pages not yet loaded into the conversation window. Features:
 *
 * - newest-first list with an oldest/newest toggle and live text filtering;
 * - one-click copy of any message's text (Clipboard API with execCommand
 *   fallback);
 * - click a message already in the window → smooth-scroll + flash highlight;
 * - click an "未加载" (not-loaded) message → auto-calls the session's official
 *   `loadOlder()` page by page until the target lands in the window, then
 *   scrolls to it (product API, no DOM hacks).
 *
 * The host half (lib/index.js) serves the full-history JSON over the fenced
 * `/history/api/list-user-messages` route; this bundle calls it with plain
 * fetch (a third-party plugin has no `host.call`). Styles are injected as a
 * style tag (no `styles` builtin outside the dynamic-plugin sandbox).
 */
import { createElement, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'

/** ------------------------------------------------------------------ types */

/** The client slots service face (structural subset used here). */
interface HistorySlotsService {
  inject(key: string, callback: () => () => void): () => void
  register(options: {
    name: string
    id?: string
    order?: number
  }, component: (props: HistoryDockProps) => ReactElement): () => void
}

/** The client sessions service face (structural subset used here). */
interface HistorySessionsService {
  binding(id: string): {
    session: { loadOlder(): Promise<void> }
  } | undefined
}

/** The conversation snapshot slice this plugin reads (structural subset). */
interface HistoryConversationSnapshot {
  sessionId?: string
  hasMore?: boolean
  loadingOlder?: boolean
  chat?: {
    nodes?: {
      values(): readonly HistoryChatNode[]
    }
  }
}

/** One materialized chat node (user or steering message). */
interface HistoryChatNode {
  kind?: string
  key?: string
  anchorSeq?: number
  visibility?: string
  data?: {
    seq?: number
    time?: number
    content?: readonly HistoryContentBlock[]
  }
}

/** One content block (structural subset: the text/image/tool shapes). */
interface HistoryContentBlock {
  type?: string
  text?: string
  name?: string
}

/** One full-history row from the host route. */
interface HistoryHostItem {
  seq: number
  time: number
  text: string
}

/** One rendered list row (host data merged with the local-window key). */
interface HistoryRow {
  seq: number
  time: number
  text: string
  key: string | null
}

/** Props the dock slot renders with. */
interface HistoryDockProps {
  session?: HistoryConversationSnapshot
}

/** Timer service face (optional; used to auto-clear the copy feedback). */
interface HistoryTimer {
  timeout(callback: () => void, delay: number): () => void
}

declare module 'cordis' {
  interface Context {
    slots: HistorySlotsService
    sessions?: HistorySessionsService
    timer?: HistoryTimer
  }
}

/** ------------------------------------------------------------------ styles */

const CSS = `
.dshm_root{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) * 2 - var(--dsh-composer-dock-inset) * 2);max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) * 2);margin:0 auto;padding:0 var(--dsh-composer-dock-inset);font-family:Inter,var(--dsw-font-family)}
.dshm_trigger{box-sizing:border-box;width:100%;height:36px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:var(--dsw-specific-tip);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;align-items:center;gap:10px;padding:4px 12px;font-size:13px;font-weight:500;line-height:20px;display:flex}
.dshm_trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshm_badge{flex:auto;min-width:0;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.dshm_chevron{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshm_panel{box-sizing:border-box;background:var(--dsw-specific-tip);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;margin-top:6px;overflow:hidden}
.dshm_toolrow{box-sizing:border-box;align-items:center;gap:8px;margin:8px 8px 0;padding:0;display:flex}
.dshm_search{box-sizing:border-box;width:100%;height:32px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;padding:0 10px;font:inherit;font-size:13px;line-height:20px;flex:auto;min-width:0}
.dshm_search:focus{border-color:var(--dsw-alias-state-business-primary)}
.dshm_search::placeholder{color:var(--dsw-alias-label-caption)}
.dshm_order{height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-interactive-bg-hover);border:none;border-radius:8px;padding:0 10px;font-size:12px;font-weight:500;line-height:20px;flex:none;white-space:nowrap}
.dshm_order:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dshm_list{max-height:264px;margin:6px 0 0;padding:0 6px 8px;list-style:none;overflow-y:auto}
.dshm_row{box-sizing:border-box;border-radius:8px;align-items:center;gap:10px;width:100%;padding:6px 8px;font-size:13px;line-height:18px;display:flex}
.dshm_row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshm_time{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:18px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dshm_text{min-width:0;color:var(--dsw-alias-label-primary-dimmed);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;flex:auto;cursor:pointer}
.dshm_copy{width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;place-items:center;padding:0;display:grid;font-size:12px}
.dshm_copy:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshm_tag{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:18px;white-space:nowrap;cursor:pointer}
.dshm_tagLoaded{flex:none;color:var(--dsw-alias-state-success-primary);font-size:11px;line-height:18px;white-space:nowrap}
.dshm_tagPending{flex:none;color:var(--dsw-alias-state-warn-primary);font-size:11px;line-height:18px;white-space:nowrap}
.dshm_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:13px;line-height:20px}
.dshm_notice{color:var(--dsw-alias-state-warn-primary);padding:4px 12px 8px;font-size:12px;line-height:18px}
.dshm_loading{color:var(--dsw-alias-label-caption);padding:8px;font-size:12px;line-height:18px}
.dshm_error{color:var(--dsw-alias-state-error-primary);padding:8px;font-size:12px;line-height:18px}
.dshm_retry{height:24px;color:var(--dsw-alias-state-error-primary);cursor:pointer;background:var(--dsw-alias-interactive-bg-hover-danger);border:none;border-radius:6px;margin-left:8px;padding:0 10px;font-size:12px;line-height:20px;vertical-align:middle}
.dshm_retry:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshm_flash{animation:dshmFlash 1.6s ease-out}
@keyframes dshmFlash{0%,25%{box-shadow:0 0 0 3px var(--dsw-alias-state-business-primary)}100%{box-shadow:0 0 0 3px transparent}}
@media (prefers-reduced-motion:reduce){.dshm_flash{animation:none}}
`

/** Inject the plugin stylesheet once per activation (removed on disposal). */
function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector('style[data-plugin-css="dsh-history/styles"]') !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-history'
  tag.dataset.pluginCss = 'dsh-history/styles'
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
  }
}

/** ------------------------------------------------------------------ utils */

/**
 * module-level prefetch cache: sessionId → full-history items. The dock
 * component prefetches on mount (every session renders its own dock), so
 * opening the panel later reads this cache and renders instantly. A panel
 * open with a stale/absent cache still fetches fresh and re-caches.
 */
const prefetchCache = new Map<string, { at: number; items: HistoryHostItem[] }>()

/** Prefetch TTL (ms): a fresh prefetch is served immediately; older entries
 *  are re-fetched on open so new messages surface. */
const PREFETCH_TTL = 10000

/** Full-history fetch timeout (ms): a hung host route must not pin the panel
 *  in "loading" forever — we fall back to the local window list. */
const FETCH_TIMEOUT = 8000

/** Cap on the module-level prefetch cache size: evict oldest-first so a
 *  long-lived page switching many sessions cannot grow it unboundedly. */
const PREFETCH_CACHE_MAX = 20

/** Cap on sequential auto-load pages while hunting one target message:
 *  guards against pathological loops if the host keeps reporting hasMore. */
const MAX_AUTO_LOAD_PAGES = 30

/** Cap on rendered rows: an enormous history would otherwise render
 *  hundreds of DOM nodes; show the newest N and a hint. */
const MAX_RENDERED_ROWS = 200

/** Fetch the full history for a session (network + re-cache, with timeout). */
function fetchFullHistory(sessionId: string): Promise<{ ok: boolean; items: HistoryHostItem[]; error?: string }> {
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController()
  const timer = controller !== undefined && typeof setTimeout === 'function'
    ? setTimeout(() => { controller.abort() }, FETCH_TIMEOUT)
    : undefined
  return fetch(`/history/api/list-user-messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
    signal: controller?.signal,
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data: unknown) => {
      const record = data as { ok?: boolean; items?: HistoryHostItem[]; error?: string }
      if (record && record.ok === true && Array.isArray(record.items)) {
        // bounded cache: evict oldest entry when over the cap.
        if (prefetchCache.size >= PREFETCH_CACHE_MAX) {
          const oldest = prefetchCache.keys().next().value
          if (oldest !== undefined) prefetchCache.delete(oldest)
        }
        prefetchCache.set(sessionId, { at: Date.now(), items: record.items })
        return { ok: true, items: record.items }
      }
      return { ok: false, items: [], error: record?.error ?? '读取完整历史失败' }
    })
    .catch((err: unknown) => ({
      ok: false,
      items: [],
      error: err instanceof DOMException && err.name === 'AbortError' ? '请求超时' : String(err instanceof Error ? err.message : err),
    }))
    .finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
}

/** Flatten one message's content blocks to a single preview string. */
function textOf(content: readonly HistoryContentBlock[] | undefined): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const b of content) {
    if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b && b.type === 'image') parts.push('[图片]')
    else if (b && b.type === 'tool-call' && typeof b.name === 'string') parts.push('[工具: ' + b.name + ']')
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** Format a Unix epoch ms timestamp: same-day messages show HH:mm only;
 *  earlier ones show YYYY-MM-DD (plus HH:mm for older-than-a-week clarity). */
function fmtTime(ms: number): string {
  if (!ms || typeof ms !== 'number') return ''
  try {
    const d = new Date(ms)
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate()
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (sameDay) return time
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
  } catch {
    return ''
  }
}

/** Find the conversation row DOM element for a chat-node anchor key. */
function findAnchor(key: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const rows = document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row && row.dataset && row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Copy text to the clipboard: Clipboard API first, execCommand fallback. */
function copyText(text: string): Promise<boolean> {
  if (!text) return Promise.resolve(false)
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text))
  }
  return Promise.resolve(fallbackCopy(text))
}

function fallbackCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** Collect the messages visible in the currently loaded window + seq→key map. */
function localWindowItems(session: HistoryConversationSnapshot | undefined): {
  items: HistoryRow[]
  keys: Map<number, string>
} {
  const items: HistoryRow[] = []
  const keys = new Map<number, string>()
  if (!session || !session.chat || !session.chat.nodes) return { items, keys }
  let nodes: readonly HistoryChatNode[] = []
  try {
    nodes = session.chat.nodes.values()
  } catch {
    nodes = []
  }
  for (const node of nodes) {
    if (!node) continue
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    if (node.visibility === 'hidden') continue
    const data = node.data || {}
    const seq = typeof node.anchorSeq === 'number' ? node.anchorSeq : (typeof data.seq === 'number' ? data.seq : 0)
    if (typeof node.key === 'string' && node.key) keys.set(seq, node.key)
    items.push({
      seq,
      time: typeof data.time === 'number' ? data.time : 0,
      text: textOf(data.content),
      key: typeof node.key === 'string' ? node.key : null,
    })
  }
  items.sort((a, b) => a.seq - b.seq)
  return { items, keys }
}

/** Smooth-scroll to a message row and flash-highlight it. */
function scrollToKey(key: string): boolean {
  const el = findAnchor(key)
  if (!el) return false
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove('dshm-flash')
    void el.offsetWidth
    el.classList.add('dshm-flash')
    el.addEventListener('animationend', () => el.classList.remove('dshm-flash'), { once: true })
  } catch {
    return false
  }
  return true
}

/** ------------------------------------------------------------------ view */

/** The dock component: full-history listing + jump + copy. */
function HistoryDock(props: HistoryDockProps & {
  loadOlderFor?: (id: string) => Promise<void>
  timeout?: HistoryTimer['timeout']
}): ReactElement {
  const session = props.session
  const sessionId = session?.sessionId
  const loadOlderFor = props.loadOlderFor
  const timeout = props.timeout
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [desc, setDesc] = useState(true)
  const [hostItems, setHostItems] = useState<HistoryHostItem[] | null>(null)
  const [hostState, setHostState] = useState<'idle' | 'loading' | 'loaded' | 'error' | 'fallback'>('idle')
  const [hostError, setHostError] = useState<string | null>(null)
  const [pendingSeq, setPendingSeq] = useState<number | null>(null)
  const [copiedSeq, setCopiedSeq] = useState<number | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [retryToken, setRetryToken] = useState(0)
  const [autoLoadPages, setAutoLoadPages] = useState(0)

  const local = useMemo(() => localWindowItems(session), [session])

  const showError = (message: string): void => { setHostState('error'); setHostError(message) }
  const showLoaded = (items: HistoryHostItem[]): void => { setHostItems(items); setHostState('loaded') }

  // Prefetch the full history on mount (every session renders its own dock),
  // so opening the panel later renders instantly from the cache. The panel
  // re-fetches on open only when the prefetch is stale or absent.
  useEffect(() => {
    if (sessionId === undefined) return
    let cancelled = false
    if (!prefetchCache.has(String(sessionId))) {
      fetchFullHistory(String(sessionId)).then((res) => {
        if (cancelled) return
        if (res.ok) showLoaded(res.items)
        else if (hostState !== 'loaded') showError(res.error ?? '读取完整历史失败')
      })
    }
    return () => { cancelled = true }
    // retryToken re-runs the prefetch after a failed fetch; hostState guards
    // against overwriting a later successful load.
  }, [sessionId, retryToken])

  // On panel open, seed from the prefetch cache immediately, then re-fetch
  // if the cached entry is stale (or missing) so new messages appear.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setNotice(null)
    setPendingSeq(null)
    setLoadFailed(false)
    setAutoLoadPages(0)
    const sid = String(sessionId)
    const cached = prefetchCache.get(sid)
    if (cached !== undefined) {
      setHostItems(cached.items)
      setHostState('loaded')
      if (Date.now() - cached.at < PREFETCH_TTL) return
      // stale: re-fetch in the background; keep showing the cached list.
      fetchFullHistory(sid).then((res) => {
        if (cancelled) return
        if (res.ok) showLoaded(res.items)
        else showError(res.error ?? '读取完整历史失败')
      })
      return
    }
    setHostState('loading')
    setHostError(null)
    fetchFullHistory(sid).then((res) => {
      if (cancelled) return
      if (res.ok) showLoaded(res.items)
      else showError(res.error ?? '读取完整历史失败')
    })
    return () => { cancelled = true }
  }, [open, sessionId, retryToken])

  // Merge: host full list (when loaded) with the local-window seq→key map.
  const items = useMemo<HistoryRow[]>(() => {
    let base: HistoryRow[]
    if (hostState === 'loaded' && Array.isArray(hostItems)) {
      base = hostItems.map((it) => ({
        seq: it.seq,
        time: it.time,
        text: it.text || '',
        key: local.keys.get(it.seq) ?? null,
      }))
    } else {
      base = local.items
    }
    const out = base.slice()
    if (desc) out.sort((a, b) => b.seq - a.seq)
    else out.sort((a, b) => a.seq - b.seq)
    return out
  }, [hostState, hostItems, local, desc])

  const filtered = useMemo<HistoryRow[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => it.text.toLowerCase().indexOf(q) !== -1)
  }, [items, query])

  // Auto-load earlier history until the pending target lands in the window.
  useEffect(() => {
    if (pendingSeq === null) return
    if (!session || !session.chat) return
    if (local.keys.has(pendingSeq)) {
      const it = items.find((x) => x.seq === pendingSeq)
      if (it && it.key) {
        const ok = scrollToKey(it.key)
        if (ok) {
          setOpen(false)
          setQuery('')
          setNotice(null)
        } else {
          setNotice('该消息已加载但当前视图不可见，无法滚动定位。')
        }
      }
      setPendingSeq(null)
      setAutoLoadPages(0)
      return
    }
    if (loadFailed) return
    if (autoLoadPages >= MAX_AUTO_LOAD_PAGES) {
      setLoadFailed(true)
      setNotice(`连续加载 ${MAX_AUTO_LOAD_PAGES} 页仍未找到该消息，已停止。可尝试向上滚动加载更早内容后重试。`)
      return
    }
    if (session.hasMore && !session.loadingOlder) {
      try {
        const p = loadOlderFor?.(String(sessionId))
        if (p && typeof p.then === 'function') {
          setAutoLoadPages((n) => n + 1)
          p.catch(() => {
            setLoadFailed(true)
            setNotice('加载更早历史失败，无法定位该消息。')
          })
        }
      } catch {
        setLoadFailed(true)
        setNotice('加载更早历史失败，无法定位该消息。')
      }
    } else if (!session.hasMore) {
      setLoadFailed(true)
      setNotice('已加载到该会话最早的记录，仍未找到这条消息（可能已被删除）。')
    }
  }, [pendingSeq, local.keys, items, loadFailed, session, sessionId, loadOlderFor, autoLoadPages])

  const jumpTo = (it: HistoryRow): void => {
    if (it.key) {
      if (scrollToKey(it.key)) {
        setOpen(false)
        setQuery('')
        setNotice(null)
        return
      }
      setNotice('该消息当前不在 Chat 视图的已加载内容中，无法直接滚动定位。')
      return
    }
    if (pendingSeq === it.seq) return
    if (typeof loadOlderFor !== 'function') {
      setNotice('这条消息位于更早的历史中，尚未加载到当前对话窗口。当前环境无法自动加载更早历史，可先向上滚动加载。')
      return
    }
    setNotice('正在向上加载更早历史以定位该消息…')
    setPendingSeq(it.seq)
    setLoadFailed(false)
  }

  const doCopy = (it: HistoryRow, e: { stopPropagation(): void }): void => {
    e.stopPropagation()
    copyText(it.text).then((ok) => {
      if (ok) {
        setCopiedSeq(it.seq)
        // auto-restore the ⧉ affordance after a beat (timer is optional;
        // without it the ✓ stays until the next copy).
        if (typeof timeout === 'function') {
          timeout(() => setCopiedSeq((cur) => (cur === it.seq ? null : cur)), 1400)
        }
      } else {
        setNotice('复制失败。')
      }
    })
  }

  // Close the panel on Escape, and blur-safe outside click handling.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [open])

  const children: ReactElement[] = []
  children.push(createElement('button', {
    key: 'trigger',
    type: 'button',
    className: 'dshm_trigger',
    onClick: () => { setOpen(!open); setQuery(''); setNotice(null); setPendingSeq(null) },
    'aria-expanded': open,
    'aria-label': '我的消息',
  }, [
    createElement('span', { key: 'badge', className: 'dshm_badge' }, `我的消息 (${items.length})`),
    createElement('span', { key: 'chev', className: 'dshm_chevron' }, open ? '▾' : '▸'),
  ]))

  if (open) {
    const panel: ReactElement[] = []
    panel.push(createElement('div', { key: 'tools', className: 'dshm_toolrow' }, [
      createElement('input', {
        key: 'search',
        className: 'dshm_search',
        type: 'text',
        placeholder: '搜索我发过的消息…',
        value: query,
        onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
        autoFocus: true,
      }),
      createElement('button', {
        key: 'order',
        type: 'button',
        className: 'dshm_order',
        onClick: () => setDesc(!desc),
      }, desc ? '最新在前' : '最早在前'),
    ]))
    if (hostState === 'loading') {
      panel.push(createElement('div', { key: 'loading', className: 'dshm_loading' }, '正在读取完整历史…'))
    } else if (hostState === 'error') {
      panel.push(createElement('div', { key: 'error', className: 'dshm_error' }, [
        `完整历史读取失败：${hostError ?? '未知错误'}（当前仅显示已加载窗口内的消息）`,
        createElement('button', {
          key: 'retry',
          type: 'button',
          className: 'dshm_retry',
          onClick: () => setRetryToken((n) => n + 1),
        }, '重试'),
      ]))
    }
    if (filtered.length > 0) {
      const trimmed = filtered.slice(0, MAX_RENDERED_ROWS)
      const rows = trimmed.map((it) => {
        const pending = pendingSeq === it.seq
        const copied = copiedSeq === it.seq
        const tagClass = pending ? 'dshm_tagPending' : (it.key ? 'dshm_tagLoaded' : 'dshm_tag')
        const tagText = pending ? '加载中…' : (it.key ? '可定位' : '未加载')
        return createElement('li', {
          key: `m${it.seq}`,
          className: 'dshm_row',
          title: it.text || '(无文本)',
        }, [
          createElement('span', { key: 't', className: 'dshm_time' }, fmtTime(it.time)),
          createElement('span', {
            key: 'x',
            className: 'dshm_text',
            role: 'button',
            tabIndex: 0,
            'aria-label': `跳转到：${it.text || '(无文本)'}`,
            onClick: () => jumpTo(it),
            onKeyDown: (e: { key: string; preventDefault(): void }) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpTo(it) }
            },
          }, it.text || '(无文本)'),
          createElement('span', { key: 'tag', className: tagClass, onClick: () => jumpTo(it) }, tagText),
          createElement('button', {
            key: 'c',
            type: 'button',
            className: 'dshm_copy',
            title: copied ? '已复制' : '复制文本',
            'aria-label': copied ? '已复制' : '复制消息文本',
            onClick: (e: { stopPropagation(): void }) => doCopy(it, e),
          }, copied ? '✓' : '⧉'),
        ])
      })
      panel.push(createElement('ul', { key: 'list', className: 'dshm_list' }, rows))
      if (filtered.length > MAX_RENDERED_ROWS) {
        panel.push(createElement('div', { key: 'cap', className: 'dshm_notice' }, `仅显示最近 ${MAX_RENDERED_ROWS} 条匹配消息（共 ${filtered.length} 条）；使用搜索框可缩小范围。`))
      }
    } else if (hostState !== 'loading') {
      panel.push(createElement('div', { key: 'empty', className: 'dshm_empty' }, query.trim() ? '没有匹配的消息。' : '这个会话里还没有你发起的消息。'))
    }
    if (hostState === 'loaded' && Array.isArray(hostItems) && hostItems.length > items.length) {
      panel.push(createElement('div', { key: 'more', className: 'dshm_notice' }, `已显示全部 ${hostItems.length} 条你发送的消息；${hostItems.length - local.items.length} 条位于已加载窗口之外（点击可自动加载并定位，或先向上滚动加载）。`))
    }
    if (notice) {
      panel.push(createElement('div', { key: 'notice', className: 'dshm_notice' }, notice))
    }
    children.push(createElement('div', { key: 'panel', className: 'dshm_panel' }, panel))
  }

  return createElement('div', { className: 'dshm_root' }, children)
}

/** ------------------------------------------------------------------ plugin */

/** Services required before mounting: the slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: inject the stylesheet and register the dock row.
 * @param ctx - client plugin context (slots, sessions).
 */
export function apply(ctx: Context): void {
  ctx.effect(() => injectStyles(), 'dsh-history: stylesheet')
  const slots = ctx.get('slots') as HistorySlotsService | undefined
  if (slots === undefined) return
  const sessions = ctx.get('sessions') as HistorySessionsService | undefined
  const timer = ctx.get('timer') as HistoryTimer | undefined
  const timeout = timer?.timeout.bind(timer)
  const loadOlderFor = sessions === undefined
    ? undefined
    : (id: string): Promise<void> => {
      const b = sessions.binding(id)
      if (b === undefined || !b.session || typeof b.session.loadOlder !== 'function') return Promise.resolve()
      return b.session.loadOlder()
    }
  slots.inject('conversation.input.dock', () => slots.register(
    { name: 'conversation.input.dock', id: 'dsh-history', order: 30 },
    (props: HistoryDockProps) => createElement(HistoryDock, { session: props.session, loadOlderFor, timeout }),
  ))
}
