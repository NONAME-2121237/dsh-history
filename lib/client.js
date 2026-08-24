window.__ModuleLoader__.load({
	id: "dsh-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/util.ts
		/** Truncate a string to at most `max` code units with an ellipsis. */
		function truncate(text, max) {
			if (!text) return "";
			if (text.length <= max) return text;
			return `${text.slice(0, max)}…`;
		}
		/** Clamp a number into [min, max]. */
		function clamp(n, min, max) {
			return n < min ? min : n > max ? max : n;
		}
		/** Find the nearest overflow-y scroll ancestor of an element (the message
		*  viewport for rows inside the conversation). Pass `includeSelf` to also
		*  accept the element itself when it is the scrollport. */
		function findScrollPort(el, includeSelf = false) {
			let node = includeSelf ? el : el.parentElement;
			while (node !== null) {
				const overflow = getComputedStyle(node).overflowY;
				if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return node;
				node = node.parentElement;
			}
			return null;
		}
		/** Flatten one message's content blocks to a single preview string. */
		function textOf(content) {
			if (!Array.isArray(content)) return "";
			const parts = [];
			for (const b of content) if (b && b.type === "text" && typeof b.text === "string") parts.push(b.text);
			else if (b && b.type === "image") parts.push("[图片]");
			else if (b && b.type === "tool-call" && typeof b.name === "string") parts.push("[工具: " + b.name + "]");
			return parts.join(" ").replace(/\s+/g, " ").trim();
		}
		/** Format a Unix epoch ms timestamp: same-day → HH:mm; else YYYY-MM-DD HH:mm. */
		function fmtTime(ms) {
			if (!ms || typeof ms !== "number") return "";
			try {
				const d = new Date(ms);
				const now = /* @__PURE__ */ new Date();
				const pad = (n) => String(n).padStart(2, "0");
				const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
				const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
				if (sameDay) return time;
				return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
			} catch {
				return "";
			}
		}
		/** Collect the user/steering messages in the loaded window + seq→key map. */
		function collectWindowItems(session) {
			const items = [];
			const keys = /* @__PURE__ */ new Map();
			if (!session || !session.chat || !session.chat.nodes) return {
				items,
				keys
			};
			let nodes = [];
			try {
				nodes = session.chat.nodes.values();
			} catch {
				nodes = [];
			}
			for (const node of nodes) {
				if (!node) continue;
				if (node.kind !== "user" && node.kind !== "steering") continue;
				if (node.visibility === "hidden") continue;
				const data = node.data || {};
				const seq = typeof node.anchorSeq === "number" ? node.anchorSeq : typeof data.seq === "number" ? data.seq : 0;
				if (typeof node.key === "string" && node.key) keys.set(seq, node.key);
				items.push({
					seq,
					time: typeof data.time === "number" ? data.time : 0,
					text: textOf(data.content),
					key: typeof node.key === "string" ? node.key : null
				});
			}
			items.sort((a, b) => a.seq - b.seq);
			return {
				items,
				keys
			};
		}
		/** Find the conversation row DOM element for a chat-node anchor key. */
		function findAnchor(key) {
			if (typeof document === "undefined") return null;
			const rows = document.querySelectorAll("[data-chat-anchor-key]");
			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				if (row && row.dataset && row.dataset.chatAnchorKey === key) return row;
			}
			return null;
		}
		/** Scroll a message row into view (centered) and flash-highlight it.
		*  Positions the conversation scrollport directly (synchronous, reliable),
		*  rather than relying on async scrollIntoView which can silently no-op. */
		function scrollToKey(key) {
			const el = findAnchor(key);
			if (!el) return false;
			try {
				el.classList.remove("dshm-flash");
				el.offsetWidth;
				el.classList.add("dshm-flash");
				el.addEventListener("animationend", () => el.classList.remove("dshm-flash"), { once: true });
				let port = null;
				let node = el.parentElement;
				while (node !== null) {
					const overflow = getComputedStyle(node).overflowY;
					if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") {
						port = node;
						break;
					}
					node = node.parentElement;
				}
				if (port !== null) {
					const elRect = el.getBoundingClientRect();
					const portRect = port.getBoundingClientRect();
					const target = port.scrollTop + elRect.top - portRect.top - portRect.height / 2 + elRect.height / 2;
					if (Math.abs(target - port.scrollTop) > 1) port.scrollTop = target;
					return true;
				}
				try {
					el.scrollIntoView({
						behavior: "smooth",
						block: "center"
					});
				} catch {
					return false;
				}
				return true;
			} catch {
				return false;
			}
		}
		//#endregion
		//#region src/client/index.ts
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
		/** ------------------------------------------------------------------ styles */
		/** Inject the plugin stylesheet once per activation (removed on disposal). */
		function injectStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.querySelector("style[data-plugin-css=\"dsh-history/styles\"]") !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-history";
			tag.dataset.pluginCss = "dsh-history/styles";
			tag.textContent = TIMELINE_CSS;
			document.head.appendChild(tag);
			return () => {
				if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
			};
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
`;
		/** Timeline overlay: the right-edge turn-rail (spec F2-F5). */
		function TimelineOverlay(props) {
			const session = props.session;
			const sessionId = session?.sessionId;
			const [turns, setTurns] = (0, react.useState)([]);
			const [winStart, setWinStart] = (0, react.useState)(0);
			const [hoverIdx, setHoverIdx] = (0, react.useState)(null);
			const [activeSeq, setActiveSeq] = (0, react.useState)(null);
			const [flashSeq, setFlashSeq] = (0, react.useState)(null);
			const [retryAnchor, setRetryAnchor] = (0, react.useState)(null);
			const [pos, setPos] = (0, react.useState)(null);
			const [tip, setTip] = (0, react.useState)(null);
			const rootRef = (0, react.useRef)(null);
			const portRef = (0, react.useRef)(null);
			const winStartRef = (0, react.useRef)(winStart);
			winStartRef.current = winStart;
			const turnsRef = (0, react.useRef)(turns);
			turnsRef.current = turns;
			const domTurnRef = (0, react.useRef)(/* @__PURE__ */ new Map());
			const VISIBLE = 10;
			const keys = (0, react.useMemo)(() => collectWindowItems(session).keys, [session]);
			const seqByKey = (0, react.useMemo)(() => {
				const m = /* @__PURE__ */ new Map();
				for (const [seq, key] of keys) if (key !== null) m.set(key, seq);
				return m;
			}, [keys]);
			(0, react.useEffect)(() => {
				if (sessionId === void 0) return;
				let cancelled = false;
				setActiveSeq(null);
				setWinStart(0);
				const load = () => {
					fetch("/history/api/list-turns", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId: String(sessionId) }),
						cache: "no-store"
					}).then((res) => res.ok ? res.json() : Promise.reject(/* @__PURE__ */ new Error(`HTTP ${res.status}`))).then((data) => {
						if (cancelled) return;
						const record = data;
						if (record && record.ok === true && Array.isArray(record.turns)) {
							const next = record.turns;
							if (next.length > 0) setActiveSeq((prev) => prev !== null && next.some((t) => t.seq === prev) ? prev : next[next.length - 1].seq);
							setTurns(next);
						}
					}).catch(() => {});
				};
				load();
				const timer = setInterval(load, 3e3);
				const detect = setInterval(() => {
					const port = portRef.current;
					if (port !== null) {
						if (port.getBoundingClientRect().height > 0 && port.querySelector("[data-chat-anchor-key]") !== null) requestAnimationFrame(() => {
							const evt = new Event("scroll");
							port.dispatchEvent(evt);
						});
					}
				}, 1e3);
				return () => {
					cancelled = true;
					clearInterval(timer);
					clearInterval(detect);
				};
			}, [sessionId, seqByKey]);
			(0, react.useEffect)(() => {
				const el = rootRef.current;
				if (!el) return;
				let raf = 0;
				let bound = null;
				const resolvePort = () => {
					const row = document.querySelector("[data-chat-anchor-key]");
					if (row !== null) {
						const p = findScrollPort(row);
						if (p !== null) return p;
					}
					const seat = document.querySelector("[data-composer-seat]");
					if (seat !== null && seat.parentElement !== null) {
						const p = findScrollPort(seat.parentElement, true);
						if (p !== null) return p;
					}
					return null;
				};
				const onScroll = () => {
					cancelAnimationFrame(raf);
					raf = requestAnimationFrame(() => {
						const port = portRef.current;
						if (port === null) return;
						const turnsList = turnsRef.current;
						if (turnsList.length === 0) return;
						const rect = port.getBoundingClientRect();
						if (rect.height === 0) return;
						const center = rect.top + rect.height * .42;
						let bestN = null;
						let bestDist = Infinity;
						const domTurn = domTurnRef.current;
						const rows = port.querySelectorAll("[data-chat-anchor-key]");
						for (let i = 0; i < rows.length; i++) {
							const r = rows[i];
							if (r === null) continue;
							const key = r.dataset.chatAnchorKey;
							if (typeof key !== "string" || key === "") continue;
							const m = /^(\d+):([a-z-]+)/.exec(key);
							if (m === null) continue;
							if (!m[2].startsWith("input-message")) continue;
							const n = Number(m[1]);
							const idx = n - 1;
							if (idx < 0 || idx >= turnsList.length) continue;
							if (!domTurn.has(n)) domTurn.set(n, key);
							const rr = r.getBoundingClientRect();
							const inView = rr.bottom > rect.top && rr.top < rect.bottom;
							const dist = Math.abs(rr.top + rr.height / 2 - center) + (inView ? 0 : 1e6);
							if (dist < bestDist) {
								bestDist = dist;
								bestN = n;
							}
						}
						if (bestN !== null) {
							const seq = turnsList[bestN - 1].seq;
							setActiveSeq((prev) => prev === seq ? prev : seq);
						}
					});
				};
				const update = () => {
					const portNew = resolvePort();
					if (portNew !== bound) {
						if (bound !== null) bound.removeEventListener("scroll", onScroll);
						bound = portNew;
						portRef.current = portNew;
						if (portNew !== null) portNew.addEventListener("scroll", onScroll, { passive: true });
					}
					const r = (portNew ?? el.parentElement ?? el).getBoundingClientRect();
					const right = Math.max(4, window.innerWidth - r.right + 6);
					const top = Math.max(4, r.top + r.height / 2);
					setPos((prev) => prev && prev.top === top && prev.right === right ? prev : {
						top,
						right
					});
					if (portNew !== null && portRef.current === portNew) onScroll();
				};
				const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
				ro?.observe(el.parentElement ?? el);
				window.addEventListener("resize", update);
				const timer = setInterval(update, 1e3);
				update();
				return () => {
					ro?.disconnect();
					clearInterval(timer);
					window.removeEventListener("resize", update);
					if (bound !== null) bound.removeEventListener("scroll", onScroll);
					cancelAnimationFrame(raf);
				};
			}, [seqByKey]);
			(0, react.useEffect)(() => {
				const list = turnsRef.current;
				if (list.length === 0) return;
				const activeIdx = activeSeq === null ? list.length - 1 : list.findIndex((t) => t.seq === activeSeq);
				const idx = activeIdx === -1 ? list.length - 1 : activeIdx;
				const maxStart = Math.max(0, list.length - VISIBLE);
				const want = clamp(idx - Math.floor(VISIBLE / 2), 0, maxStart);
				if (winStartRef.current !== want) setWinStart(want);
			}, [activeSeq, turns]);
			const count = turns.length;
			const maxStart = Math.max(0, count - VISIBLE);
			const shown = turns.slice(winStart, winStart + VISIBLE);
			const activeIdx = activeSeq === null ? -1 : turns.findIndex((t) => t.seq === activeSeq);
			const activeInWindow = activeIdx >= winStart && activeIdx < winStart + VISIBLE;
			const handleWheel = (e) => {
				e.preventDefault();
				const step = e.deltaY > 0 ? 1 : -1;
				setWinStart((s) => clamp(s + step, 0, maxStart));
			};
			const recenter = () => {
				const list = turnsRef.current;
				if (list.length === 0) return;
				const idx = activeSeq === null ? list.length - 1 : Math.max(0, list.findIndex((t) => t.seq === activeSeq));
				const i = idx === -1 ? list.length - 1 : idx;
				setWinStart(clamp(i - Math.floor(VISIBLE / 2), 0, Math.max(0, list.length - VISIBLE)));
			};
			const jumpToTurn = (turn) => {
				const idx = turnsRef.current.findIndex((t) => t.seq === turn.seq);
				const key = keys.get(turn.seq) ?? domTurnRef.current.get(idx + 1);
				if (key === null || key === void 0) {
					if (typeof props.loadOlderFor === "function" && props.session?.hasMore) props.loadOlderFor(String(sessionId)).then(() => {
						setRetryAnchor(turn.seq);
					}).catch(() => {});
					return;
				}
				if (findAnchor(key) !== null) scrollToKey(key);
				setFlashSeq(turn.seq);
				if (typeof props.timeout === "function") props.timeout(() => setFlashSeq((cur) => cur === turn.seq ? null : cur), 1700);
				else setTimeout(() => setFlashSeq((cur) => cur === turn.seq ? null : cur), 1700);
			};
			(0, react.useEffect)(() => {
				if (retryAnchor === null) return;
				const turn = turnsRef.current.find((t) => t.seq === retryAnchor);
				if (turn === void 0) return;
				const key = keys.get(turn.seq);
				if (key !== void 0) {
					setRetryAnchor(null);
					if (findAnchor(key) !== null) scrollToKey(key);
					setFlashSeq(turn.seq);
					if (typeof props.timeout === "function") props.timeout(() => setFlashSeq((cur) => cur === turn.seq ? null : cur), 1700);
					else setTimeout(() => setFlashSeq((cur) => cur === turn.seq ? null : cur), 1700);
				}
			}, [keys, retryAnchor]);
			const lineNodes = [];
			for (let i = 0; i < shown.length; i++) {
				const turn = shown[i];
				const idx = winStart + i;
				const isActive = activeIdx === idx;
				const isFlash = flashSeq === turn.seq;
				lineNodes.push((0, react.createElement)("div", {
					key: `t${turn.seq}`,
					className: `dsht_line${isActive ? " dsht_active" : ""}${isFlash ? " dsht_flash" : ""}`,
					"aria-label": `第 ${idx + 1} 轮`,
					onMouseEnter: () => {
						setHoverIdx(idx);
						setTip({
							turn,
							index: idx,
							at: Date.now()
						});
					},
					onMouseLeave: () => {
						setHoverIdx(null);
						setTip(null);
					},
					onClick: () => jumpToTurn(turn)
				}, (0, react.createElement)("span", { className: "dsht_bar" })));
			}
			const children = [(0, react.createElement)("div", {
				key: "track",
				className: "dsht_track",
				onWheel: handleWheel,
				onMouseLeave: () => {
					recenter();
					setHoverIdx(null);
					setTip(null);
				}
			}, lineNodes)];
			let tipNode = null;
			if (tip !== null && hoverIdx === tip.index) {
				const n = tip.index + 1;
				const attach = tip.turn.userAttachments > 0 ? `（含 ${tip.turn.userAttachments} 张图片/附件）` : "";
				const tools = tip.turn.toolCalls > 0 ? `\n调用了 ${tip.turn.toolCalls} 次工具` : "";
				tipNode = (0, react.createElement)("div", {
					key: "tip",
					className: "dsht_tip",
					ref: (node) => {
						if (node === null || pos === null) return;
						const r = node.getBoundingClientRect();
						let left = window.innerWidth - pos.right - r.width - 50;
						if (left < 8) left = Math.max(8, window.innerWidth - pos.right - r.width - 4);
						node.style.left = `${left}px`;
						node.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, pos.top - r.height / 2))}px`;
						node.style.right = "auto";
					}
				}, [
					(0, react.createElement)("div", {
						key: "h",
						className: "dsht_tipHead"
					}, [(0, react.createElement)("span", {
						key: "seq",
						className: "dsht_tipSeq"
					}, `第 ${n} 轮`), (0, react.createElement)("span", {
						key: "time",
						className: "dsht_tipTime"
					}, fmtTime(tip.turn.time))]),
					(0, react.createElement)("div", {
						key: "u",
						className: "dsht_tipLabel"
					}, "用户"),
					(0, react.createElement)("div", {
						key: "ut",
						className: "dsht_tipBody"
					}, truncate(tip.turn.userText || "(无文本)", 200)),
					(0, react.createElement)("div", {
						key: "a",
						className: "dsht_tipLabel"
					}, "Agent"),
					(0, react.createElement)("div", {
						key: "at",
						className: "dsht_tipBody"
					}, truncate(tip.turn.assistantText || "(暂无回复)", 200)),
					(0, react.createElement)("div", {
						key: "meta",
						className: "dsht_tipMeta"
					}, `${attach}${tools}`.trim())
				]);
			}
			return (0, react.createElement)(react.Fragment, null, [(0, react.createElement)("div", {
				ref: rootRef,
				className: "dsht_root",
				style: pos !== null && count > 0 ? {
					top: pos.top,
					right: pos.right,
					transform: "translateY(-50%)",
					visibility: count > 0 ? "visible" : "hidden"
				} : { visibility: "hidden" },
				"aria-hidden": activeInWindow ? void 0 : "true"
			}, children), tipNode === null ? [] : tipNode]);
		}
		/** ------------------------------------------------------------------ plugin */
		/** Services required before mounting: the slot registry. */
		const inject = ["slots"];
		/**
		* Client plugin body: inject the stylesheet and register the dock row.
		* @param ctx - client plugin context (slots, sessions, timer).
		*/
		function apply(ctx) {
			ctx.effect(() => injectStyles(), "dsh-history: stylesheet");
			const slots = ctx.get("slots");
			if (slots === void 0) return;
			const sessions = ctx.get("sessions");
			const timer = ctx.get("timer");
			const timeout = timer?.timeout.bind(timer);
			const loadOlderFor = sessions === void 0 ? void 0 : (id) => {
				const b = sessions.binding(id);
				if (b === void 0 || !b.session || typeof b.session.loadOlder !== "function") return Promise.resolve();
				return b.session.loadOlder();
			};
			slots.inject("conversation.input.dock", () => slots.register({
				name: "conversation.input.dock",
				id: "dsh-history-timeline",
				order: 40
			}, (props) => (0, react.createElement)(TimelineOverlay, {
				session: props.session,
				loadOlderFor,
				timeout
			})));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map