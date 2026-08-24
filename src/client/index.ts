/**
 * dsh-history client half: the interaction-turn timeline rail on the right
 * edge of the message area (spec F2-F5). One short tick per turn; the
 * active turn is highlighted and centered, clamped at the ends.
 *
 * Reuses DSH-native interfaces where possible:
 * - `conversation.input.dock` slot for the entry point;
 * - the product's `data-chat-anchor-key` semantic anchor + `session.loadOlder()`
 *   for jump/auto-load (see util.ts).
 * Pure helpers live in ./util.ts; this file only renders and manages state.
 */
import { createElement, Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Context } from 'cordis'
import {
  type HistoryConversationSnapshot,
  type TurnItem,
  clamp,
  collectWindowItems,
  findAnchor,
  findScrollPort,
  fmtTime,
  scrollToKey,
  truncate,
} from './util'

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
interface ClientSessionsService {
  binding(id: string): {
    session: { loadOlder(): Promise<void> }
  } | undefined
}

/** Props the dock slot renders with. */
interface HistoryDockProps {
  session?: HistoryConversationSnapshot
}

/** Timer service face (optional; used to auto-clear the flash feedback). */
interface HistoryTimer {
  timeout(callback: () => void, delay: number): () => void
}

declare module 'cordis' {
  interface Context {
    slots: HistorySlotsService
    sessions?: ClientSessionsService
    timer?: HistoryTimer
  }
}

/** ------------------------------------------------------------------ styles */


/** Inject the plugin stylesheet once per activation (removed on disposal). */
function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector('style[data-plugin-css="dsh-history/styles"]') !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-history'
  tag.dataset.pluginCss = 'dsh-history/styles'
  tag.textContent = TIMELINE_CSS
  document.head.appendChild(tag)
  return () => {
    if (tag.parentNode !== null) tag.parentNode.removeChild(tag)
  }
}

/** ------------------------------------------------------------------ timeline */

/**
 * 交互时间线 (spec F2-F5): 消息区右缘的轮次刻度轨道。
 * - 一根线 = 用户发出一次消息 (一个轮次); 最新轮次在底部 (正序)。
 * - 最多显示 10 根, 轨道内等距; 窗口外的线不渲染, 上下边缘以渐变淡出。
 * - 当前视口最近的轮次高亮为蓝色; 历史为白色。
 * - 悬停: tooltip 预览 (第 N 轮 / 时间 / 用户消息 / 回复 + 工具数), 自动翻转防溢出。
 * - 点击: 滚动到该轮用户消息, 线条短暂高亮。
 * - 滚轮: 悬停轨道时滚动线条窗口; 移开后回弹到最近消息居中。
 */
const TIMELINE_CSS = `
.dsht_root{position:fixed;z-index:9980;pointer-events:auto;user-select:none;-webkit-font-smoothing:antialiased}
.dsht_track{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:6px 4px;
  -webkit-mask-image:linear-gradient(to bottom,transparent 0,rgba(0,0,0,.85) 12%,#000 30%,#000 70%,rgba(0,0,0,.85) 88%,transparent 100%);
  mask-image:linear-gradient(to bottom,transparent 0,rgba(0,0,0,.85) 12%,#000 30%,#000 70%,rgba(0,0,0,.85) 88%,transparent 100%)}
.dsht_line{position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;width:34px;height:3px;flex:0 0 auto;padding:6px 0}
.dsht_bar{width:26px;height:3px;border-radius:2px;background:var(--dsw-alias-label-caption, rgba(120,130,150,.55));opacity:.45;transition:background .15s ease,opacity .15s ease,transform .15s ease,box-shadow .15s ease}
.dsht_line:hover .dsht_bar{opacity:.9;transform:scaleX(1.2)}
.dsht_active .dsht_bar{background:var(--dsw-alias-state-business-primary, #3b82f6);opacity:1;box-shadow:0 0 6px var(--dsw-alias-state-business-primary, #3b82f6)}
.dsht_flash .dsht_bar{animation:dshtFlashBar 1.6s ease-out}
@keyframes dshtFlashBar{0%,30%{background:var(--dsw-alias-state-business-primary, #3b82f6);opacity:1;box-shadow:0 0 10px var(--dsw-alias-state-business-primary, #3b82f6)}100%{opacity:.45;box-shadow:none}}
.dsht_tip{position:fixed;z-index:9999;max-width:min(340px,calc(100vw - 24px));border-radius:12px;padding:10px 12px;font-size:12px;line-height:1.55;
  background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4);
  border:1px solid rgba(120,130,150,.28);box-shadow:0 10px 32px rgba(0,0,0,.14);color:#1f2937;pointer-events:none}
.dsht_tipHead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:5px}
.dsht_tipSeq{font-size:12px;font-weight:700}
.dsht_tipTime{font-size:11px;opacity:.6;font-variant-numeric:tabular-nums}
.dsht_tipLabel{font-size:10px;font-weight:600;opacity:.55;margin:6px 0 2px;letter-spacing:.04em}
.dsht_tipBody{white-space:pre-wrap;word-break:break-word;opacity:.92}
.dsht_tipMeta{margin-top:4px;font-size:11px;opacity:.8}
html[data-ds-dark-theme="dark"] .dsht_tip{background:rgba(22,24,31,.9);border-color:rgba(255,255,255,.14);color:#e5e7eb}
`

/** Timeline overlay: the right-edge turn-rail (spec F2-F5). */
function TimelineOverlay(props: HistoryDockProps & {
  loadOlderFor?: (id: string) => Promise<void>
  timeout?: HistoryTimer['timeout']
}): ReactElement {
  const session = props.session
  const sessionId = session?.sessionId
  const [turns, setTurns] = useState<TurnItem[]>([])
  const [winStart, setWinStart] = useState(0)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [activeSeq, setActiveSeq] = useState<number | null>(null)
  const [flashSeq, setFlashSeq] = useState<number | null>(null)
  const [retryAnchor, setRetryAnchor] = useState<number | null>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [tip, setTip] = useState<{ turn: TurnItem; index: number; at: number } | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const portRef = useRef<HTMLElement | null>(null)
  const winStartRef = useRef(winStart)
  winStartRef.current = winStart
  const turnsRef = useRef(turns)
  turnsRef.current = turns
  // DOM-derived turn-number → anchor key map: rows carry keys like
  // "13:input-message<uuid>" / "13:tool-callxxx" whose leading integer is
  // the engine's 1-based turn number (= our turn index + 1). Click-jump
  // falls back to this map when the loaded-window seq map misses the turn.
  const domTurnRef = useRef(new Map<number, string>())

  const VISIBLE = 10

  // seq → anchor key map from the loaded window (for click-jump).
  const keys = useMemo(() => collectWindowItems(session).keys, [session])
  const seqByKey = useMemo(() => {
    const m = new Map<string, number>()
    for (const [seq, key] of keys) if (key !== null) m.set(key, seq)
    return m
  }, [keys])

  // Poll the turn list; the host cache (3s TTL) keeps this cheap. When the
  // list changes (e.g. a session switch), reset the highlight to the newest
  // turn so the rail never goes dark, then re-run the DOM detection once the
  // message rows land (they render asynchronously after switch).
  useEffect(() => {
    if (sessionId === undefined) return
    let cancelled = false
    setActiveSeq(null)
    setWinStart(0)
    const load = (): void => {
      fetch('/history/api/list-turns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: String(sessionId) }),
        cache: 'no-store',
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data: unknown) => {
          if (cancelled) return
          const record = data as { ok?: boolean; turns?: TurnItem[] }
          if (record && record.ok === true && Array.isArray(record.turns)) {
            const next = record.turns
            // 旧高亮不在新列表里时，默认高亮最新一轮（保证必有一条蓝线）。
            if (next.length > 0) {
              setActiveSeq((prev) => (
                prev !== null && next.some((t) => t.seq === prev) ? prev : next[next.length - 1].seq
              ))
            }
            setTurns(next)
          }
        })
        .catch(() => { /* keep last known state */ })
    }
    load()
    const timer = setInterval(load, 3000)
    // 消息区 DOM 在会话切换后异步渲染：定时重跑检测以纠正高亮。
    const detect = setInterval(() => {
      const port = portRef.current
      if (port !== null) {
        const rect = port.getBoundingClientRect()
        if (rect.height > 0 && port.querySelector('[data-chat-anchor-key]') !== null) {
          requestAnimationFrame(() => {
            const evt = new Event('scroll')
            port.dispatchEvent(evt)
          })
        }
      }
    }, 1000)
    return () => { cancelled = true; clearInterval(timer); clearInterval(detect) }
  }, [sessionId, seqByKey])

  // Geometry + active-turn tracking: pin the rail to the message viewport's
  // right edge. The message rows may not have rendered yet at mount time, so
  // the scrollport is re-resolved on every update; the fallback chain is
  // message-row scrollport → composer-seat parent (the message scroll body)
  // → dock container. ResizeObserver + scroll + a slow poll keep the rail
  // following sidebar/bottom-bar layout changes.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let raf = 0
    let bound: HTMLElement | null = null

    const resolvePort = (): HTMLElement | null => {
      const row = document.querySelector<HTMLElement>('[data-chat-anchor-key]')
      if (row !== null) {
        const p = findScrollPort(row)
        if (p !== null) return p
      }
      const seat = document.querySelector<HTMLElement>('[data-composer-seat]')
      if (seat !== null && seat.parentElement !== null) {
        const p = findScrollPort(seat.parentElement, true)
        if (p !== null) return p
      }
      return null
    }

    const onScroll = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const port = portRef.current
        if (port === null) return
        const turnsList = turnsRef.current
        if (turnsList.length === 0) return
        const rect = port.getBoundingClientRect()
        if (rect.height === 0) return
        const center = rect.top + rect.height * 0.42
        // 权威映射：collectWindowItems(session) 已给出「已加载窗口内 user/steering
        // 行的 seq → DOM anchor key」映射（seqByKey）。DOM 行的 key 反查 seq，
        // 再定位到 turns 数组 —— 完全不需要猜引擎 turn 编号（它是跨会话全局
        // 递增的，9/13/14...，与会话内轮次无绝对对应）。tool/assistant 行无
        // key 映射，自动被跳过。
        let bestSeq: number | null = null
        let bestDist = Infinity
        const domTurn = domTurnRef.current
        const rows = port.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i]
          if (r === null) continue
          const key = r.dataset.chatAnchorKey
          if (typeof key !== 'string' || key === '') continue
          const seq = seqByKey.get(key)
          if (seq === undefined) continue
          const tIdx = turnsList.findIndex((t) => t.seq === seq)
          if (tIdx === -1) continue
          if (!domTurn.has(tIdx)) domTurn.set(tIdx, key)
          const rr = r.getBoundingClientRect()
          // 视口内的行权重 0（最近优先）；视口外的行按距离排后。
          const inView = rr.bottom > rect.top && rr.top < rect.bottom
          const dist = Math.abs(rr.top + rr.height / 2 - center) + (inView ? 0 : 1e6)
          if (dist < bestDist) { bestDist = dist; bestSeq = seq }
        }
        if (bestSeq !== null) {
          setActiveSeq((prev) => (prev === bestSeq ? prev : bestSeq))
        }
      })
    }

    const update = (): void => {
      const portNew = resolvePort()
      if (portNew !== bound) {
        if (bound !== null) bound.removeEventListener('scroll', onScroll)
        bound = portNew
        portRef.current = portNew
        if (portNew !== null) portNew.addEventListener('scroll', onScroll, { passive: true })
      }
      const target = portNew ?? el.parentElement ?? el
      const r = target.getBoundingClientRect()
      const right = Math.max(4, window.innerWidth - r.right + 6)
      // 轨道是一列紧凑小横线，垂直居中于滚动容器（translateY(-50%) 由 CSS 承托）。
      const top = Math.max(4, r.top + r.height / 2)
      setPos((prev) => (prev && prev.top === top && prev.right === right ? prev : {
        top, right,
      }))
      if (portNew !== null && portRef.current === portNew) onScroll()
    }

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el.parentElement ?? el)
    window.addEventListener('resize', update)
    // The message list renders asynchronously after session load; re-resolve
    // the scrollport until it exists (cheap idle poll).
    const timer = setInterval(update, 1000)
    update()
    return () => {
      ro?.disconnect()
      clearInterval(timer)
      window.removeEventListener('resize', update)
      if (bound !== null) bound.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [seqByKey])

  // 窗口始终以 active 轮为中心（clamp 到窗口两端，靠近首/尾时不再居中，
  // 保证不出现空滑/空白）。
  useEffect(() => {
    const list = turnsRef.current
    if (list.length === 0) return
    const activeIdx = activeSeq === null ? list.length - 1 : list.findIndex((t) => t.seq === activeSeq)
    const idx = activeIdx === -1 ? list.length - 1 : activeIdx
    const maxStart = Math.max(0, list.length - VISIBLE)
    const want = clamp(idx - Math.floor(VISIBLE / 2), 0, maxStart)
    if (winStartRef.current !== want) {
      setWinStart(want)
    }
  }, [activeSeq, turns])

  const count = turns.length
  const maxStart = Math.max(0, count - VISIBLE)
  const shown = turns.slice(winStart, winStart + VISIBLE)
  const activeIdx = activeSeq === null ? -1 : turns.findIndex((t) => t.seq === activeSeq)
  const activeInWindow = activeIdx >= winStart && activeIdx < winStart + VISIBLE

  const handleWheel = (e: { deltaY: number; preventDefault(): void }): void => {
    e.preventDefault()
    const step = e.deltaY > 0 ? 1 : -1
    setWinStart((s) => clamp(s + step, 0, maxStart))
  }

  const recenter = (): void => {
    const list = turnsRef.current
    if (list.length === 0) return
    const idx = activeSeq === null ? list.length - 1 : Math.max(0, list.findIndex((t) => t.seq === activeSeq))
    const i = idx === -1 ? list.length - 1 : idx
    setWinStart(clamp(i - Math.floor(VISIBLE / 2), 0, Math.max(0, list.length - VISIBLE)))
  }

  const jumpToTurn = (turn: TurnItem): void => {
    const idx = turnsRef.current.findIndex((t) => t.seq === turn.seq)
    const key = keys.get(turn.seq) ?? domTurnRef.current.get(idx)
    if (key === null || key === undefined) {
      // 该轮用户消息不在已加载窗口内：尝试加载更早历史后再次定位。
      if (typeof props.loadOlderFor === 'function' && props.session?.hasMore) {
        props.loadOlderFor(String(sessionId)).then(() => {
          setRetryAnchor(turn.seq)
        }).catch(() => { /* keep silent */ })
      }
      return
    }
    if (findAnchor(key) !== null) scrollToKey(key)
    setFlashSeq(turn.seq)
    if (typeof props.timeout === 'function') {
      props.timeout(() => setFlashSeq((cur) => (cur === turn.seq ? null : cur)), 1700)
    } else {
      setTimeout(() => setFlashSeq((cur) => (cur === turn.seq ? null : cur)), 1700)
    }
  }

  // Retry a click-jump once its user row lands in the loaded window.
  useEffect(() => {
    if (retryAnchor === null) return
    const turn = turnsRef.current.find((t) => t.seq === retryAnchor)
    if (turn === undefined) return
    const key = keys.get(turn.seq)
    if (key !== undefined) {
      setRetryAnchor(null)
      if (findAnchor(key) !== null) scrollToKey(key)
      setFlashSeq(turn.seq)
      if (typeof props.timeout === 'function') {
        props.timeout(() => setFlashSeq((cur) => (cur === turn.seq ? null : cur)), 1700)
      } else {
        setTimeout(() => setFlashSeq((cur) => (cur === turn.seq ? null : cur)), 1700)
      }
    }
  }, [keys, retryAnchor])

  const lineNodes: ReactElement[] = []
  for (let i = 0; i < shown.length; i++) {
    const turn = shown[i]
    const idx = winStart + i
    const isActive = activeIdx === idx
    const isFlash = flashSeq === turn.seq
    lineNodes.push(createElement('div', {
      key: `t${turn.seq}`,
      className: `dsht_line${isActive ? ' dsht_active' : ''}${isFlash ? ' dsht_flash' : ''}`,
      'aria-label': `第 ${idx + 1} 轮`,
      onMouseEnter: () => { setHoverIdx(idx); setTip({ turn, index: idx, at: Date.now() }) },
      onMouseLeave: () => { setHoverIdx(null); setTip(null) },
      onClick: () => jumpToTurn(turn),
    }, createElement('span', { className: 'dsht_bar' })))
  }

  const children: ReactElement[] = [
    createElement('div', {
      key: 'track',
      className: 'dsht_track',
      onWheel: handleWheel,
      onMouseLeave: () => { recenter(); setHoverIdx(null); setTip(null) },
    }, lineNodes),
  ]

  // Tooltip: render once per hovered line; auto-flip so it never leaves the viewport.
  let tipNode: ReactElement | null = null
  if (tip !== null && hoverIdx === tip.index) {
    const n = tip.index + 1
    const attach = tip.turn.userAttachments > 0 ? `（含 ${tip.turn.userAttachments} 张图片/附件）` : ''
    const tools = tip.turn.toolCalls > 0 ? `\n调用了 ${tip.turn.toolCalls} 次工具` : ''
    tipNode = createElement('div', {
      key: 'tip',
      className: 'dsht_tip',
      ref: (node: HTMLDivElement | null): void => {
        if (node === null || pos === null) return
        const r = node.getBoundingClientRect()
        // 显示在轨道左侧；水平空间不足时贴右侧翻转。
        let left = window.innerWidth - pos.right - r.width - 50
        if (left < 8) left = Math.max(8, window.innerWidth - pos.right - r.width - 4)
        node.style.left = `${left}px`
        node.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, pos.top - r.height / 2))}px`
        node.style.right = 'auto'
      },
    }, [
      createElement('div', { key: 'h', className: 'dsht_tipHead' }, [
        createElement('span', { key: 'seq', className: 'dsht_tipSeq' }, `第 ${n} 轮`),
        createElement('span', { key: 'time', className: 'dsht_tipTime' }, fmtTime(tip.turn.time)),
      ]),
      createElement('div', { key: 'u', className: 'dsht_tipLabel' }, '用户'),
      createElement('div', { key: 'ut', className: 'dsht_tipBody' }, truncate(tip.turn.userText || '(无文本)', 200)),
      createElement('div', { key: 'a', className: 'dsht_tipLabel' }, 'Agent'),
      createElement('div', { key: 'at', className: 'dsht_tipBody' }, truncate(tip.turn.assistantText || '(暂无回复)', 200)),
      createElement('div', { key: 'meta', className: 'dsht_tipMeta' }, `${attach}${tools}`.trim()),
    ])
  }

  return createElement(Fragment, null, [
    createElement('div', {
      ref: rootRef,
      className: 'dsht_root',
      style: pos !== null && count > 0 ? {
        top: pos.top,
        right: pos.right,
        transform: 'translateY(-50%)',
        visibility: count > 0 ? 'visible' : 'hidden',
      } : { visibility: 'hidden' },
      'aria-hidden': activeInWindow ? undefined : 'true',
    }, children),
    tipNode === null ? [] : tipNode,
  ])
}

/** ------------------------------------------------------------------ plugin */

/** Services required before mounting: the slot registry. */
export const inject = ['slots']

/**
 * Client plugin body: inject the stylesheet and register the dock row.
 * @param ctx - client plugin context (slots, sessions, timer).
 */
export function apply(ctx: Context): void {
  ctx.effect(() => injectStyles(), 'dsh-history: stylesheet')
  const slots = ctx.get('slots') as HistorySlotsService | undefined
  if (slots === undefined) return
  const sessions = ctx.get('sessions') as ClientSessionsService | undefined
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
    { name: 'conversation.input.dock', id: 'dsh-history-timeline', order: 40 },
    (props: HistoryDockProps) => createElement(TimelineOverlay, {
      session: props.session,
      loadOlderFor,
      timeout,
    }),
  ))
}
