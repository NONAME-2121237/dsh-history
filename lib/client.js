window.__ModuleLoader__.load({
	id: "dsh-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
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
.dshm_flash{animation:dshmFlash 1.6s ease-out}
@keyframes dshmFlash{0%,25%{box-shadow:0 0 0 3px var(--dsw-alias-state-business-primary)}100%{box-shadow:0 0 0 3px transparent}}
@media (prefers-reduced-motion:reduce){.dshm_flash{animation:none}}
`;
		/** Inject the plugin stylesheet once per activation (removed on disposal). */
		function injectStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.querySelector("style[data-plugin-css=\"dsh-history/styles\"]") !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-history";
			tag.dataset.pluginCss = "dsh-history/styles";
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
			};
		}
		/** ------------------------------------------------------------------ utils */
		/** Flatten one message's content blocks to a single preview string. */
		function textOf(content) {
			if (!Array.isArray(content)) return "";
			const parts = [];
			for (const b of content) if (b && b.type === "text" && typeof b.text === "string") parts.push(b.text);
			else if (b && b.type === "image") parts.push("[图片]");
			else if (b && b.type === "tool-call" && typeof b.name === "string") parts.push("[工具: " + b.name + "]");
			return parts.join(" ").replace(/\s+/g, " ").trim();
		}
		/** Format a Unix epoch ms timestamp as a local YYYY-MM-DD HH:mm string. */
		function fmtTime(ms) {
			if (!ms || typeof ms !== "number") return "";
			try {
				const d = new Date(ms);
				const pad = (n) => String(n).padStart(2, "0");
				return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
			} catch {
				return "";
			}
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
		/** Copy text to the clipboard: Clipboard API first, execCommand fallback. */
		function copyText(text) {
			if (!text) return Promise.resolve(false);
			if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
			return Promise.resolve(fallbackCopy(text));
		}
		function fallbackCopy(text) {
			if (typeof document === "undefined") return false;
			try {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.style.position = "fixed";
				ta.style.opacity = "0";
				document.body.appendChild(ta);
				ta.select();
				const ok = document.execCommand("copy");
				document.body.removeChild(ta);
				return ok;
			} catch {
				return false;
			}
		}
		/** Collect the messages visible in the currently loaded window + seq→key map. */
		function localWindowItems(session) {
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
		/** Smooth-scroll to a message row and flash-highlight it. */
		function scrollToKey(key) {
			const el = findAnchor(key);
			if (!el) return false;
			try {
				el.scrollIntoView({
					behavior: "smooth",
					block: "center"
				});
				el.classList.remove("dshm-flash");
				el.offsetWidth;
				el.classList.add("dshm-flash");
				el.addEventListener("animationend", () => el.classList.remove("dshm-flash"), { once: true });
			} catch {
				return false;
			}
			return true;
		}
		/** ------------------------------------------------------------------ view */
		/** The dock component: full-history listing + jump + copy. */
		function HistoryDock(props) {
			const session = props.session;
			const sessionId = session?.sessionId;
			const loadOlderFor = props.loadOlderFor;
			const [open, setOpen] = (0, react.useState)(false);
			const [query, setQuery] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)(null);
			const [desc, setDesc] = (0, react.useState)(true);
			const [hostItems, setHostItems] = (0, react.useState)(null);
			const [hostState, setHostState] = (0, react.useState)("idle");
			const [hostError, setHostError] = (0, react.useState)(null);
			const [pendingSeq, setPendingSeq] = (0, react.useState)(null);
			const [copiedSeq, setCopiedSeq] = (0, react.useState)(null);
			const [loadFailed, setLoadFailed] = (0, react.useState)(false);
			const local = (0, react.useMemo)(() => localWindowItems(session), [session]);
			(0, react.useEffect)(() => {
				if (!open) return;
				let cancelled = false;
				setHostState("loading");
				setHostError(null);
				setNotice(null);
				setPendingSeq(null);
				setLoadFailed(false);
				fetch(`/history/api/list-user-messages`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sessionId: String(sessionId) })
				}).then((res) => res.ok ? res.json() : Promise.reject(/* @__PURE__ */ new Error(`HTTP ${res.status}`))).then((data) => {
					if (cancelled) return;
					const record = data;
					if (record && record.ok === true && Array.isArray(record.items)) {
						setHostItems(record.items);
						setHostState("loaded");
					} else {
						setHostState("error");
						setHostError(record?.error ?? "读取完整历史失败");
					}
				}).catch((err) => {
					if (cancelled) return;
					setHostState("error");
					setHostError(String(err instanceof Error ? err.message : err));
				});
				return () => {
					cancelled = true;
				};
			}, [open, sessionId]);
			const items = (0, react.useMemo)(() => {
				let base;
				if (hostState === "loaded" && Array.isArray(hostItems)) base = hostItems.map((it) => ({
					seq: it.seq,
					time: it.time,
					text: it.text || "",
					key: local.keys.get(it.seq) ?? null
				}));
				else base = local.items;
				const out = base.slice();
				if (desc) out.sort((a, b) => b.seq - a.seq);
				else out.sort((a, b) => a.seq - b.seq);
				return out;
			}, [
				hostState,
				hostItems,
				local,
				desc
			]);
			const filtered = (0, react.useMemo)(() => {
				const q = query.trim().toLowerCase();
				if (!q) return items;
				return items.filter((it) => it.text.toLowerCase().indexOf(q) !== -1);
			}, [items, query]);
			(0, react.useEffect)(() => {
				if (pendingSeq === null) return;
				if (!session || !session.chat) return;
				if (local.keys.has(pendingSeq)) {
					const it = items.find((x) => x.seq === pendingSeq);
					if (it && it.key) {
						if (scrollToKey(it.key)) {
							setOpen(false);
							setQuery("");
							setNotice(null);
						} else setNotice("该消息已加载但当前视图不可见，无法滚动定位。");
					}
					setPendingSeq(null);
					return;
				}
				if (loadFailed) return;
				if (session.hasMore && !session.loadingOlder) try {
					const p = loadOlderFor?.(String(sessionId));
					if (p && typeof p.then === "function") p.catch(() => {
						setLoadFailed(true);
						setNotice("加载更早历史失败，无法定位该消息。");
					});
				} catch {
					setLoadFailed(true);
					setNotice("加载更早历史失败，无法定位该消息。");
				}
				else if (!session.hasMore) {
					setLoadFailed(true);
					setNotice("已加载到该会话最早的记录，仍未找到这条消息（可能已被删除）。");
				}
			}, [
				pendingSeq,
				local.keys,
				items,
				loadFailed,
				session,
				sessionId,
				loadOlderFor
			]);
			const jumpTo = (it) => {
				if (it.key) {
					if (scrollToKey(it.key)) {
						setOpen(false);
						setQuery("");
						setNotice(null);
						return;
					}
					setNotice("该消息当前不在 Chat 视图的已加载内容中，无法直接滚动定位。");
					return;
				}
				if (pendingSeq === it.seq) return;
				if (typeof loadOlderFor !== "function") {
					setNotice("这条消息位于更早的历史中，尚未加载到当前对话窗口。当前环境无法自动加载更早历史，可先向上滚动加载。");
					return;
				}
				setNotice("正在向上加载更早历史以定位该消息…");
				setPendingSeq(it.seq);
				setLoadFailed(false);
			};
			const doCopy = (it, e) => {
				e.stopPropagation();
				copyText(it.text).then((ok) => {
					if (ok) setCopiedSeq(it.seq);
					else setNotice("复制失败。");
				});
			};
			const children = [];
			children.push((0, react.createElement)("button", {
				key: "trigger",
				type: "button",
				className: "dshm_trigger",
				onClick: () => {
					setOpen(!open);
					setQuery("");
					setNotice(null);
					setPendingSeq(null);
				},
				"aria-expanded": open
			}, [(0, react.createElement)("span", {
				key: "badge",
				className: "dshm_badge"
			}, `我的消息 (${items.length})`), (0, react.createElement)("span", {
				key: "chev",
				className: "dshm_chevron"
			}, open ? "▾" : "▸")]));
			if (open) {
				const panel = [];
				panel.push((0, react.createElement)("div", {
					key: "tools",
					className: "dshm_toolrow"
				}, [(0, react.createElement)("input", {
					key: "search",
					className: "dshm_search",
					type: "text",
					placeholder: "搜索我发过的消息…",
					value: query,
					onChange: (e) => setQuery(e.target.value),
					autoFocus: true
				}), (0, react.createElement)("button", {
					key: "order",
					type: "button",
					className: "dshm_order",
					onClick: () => setDesc(!desc)
				}, desc ? "最新在前" : "最早在前")]));
				if (hostState === "loading") panel.push((0, react.createElement)("div", {
					key: "loading",
					className: "dshm_loading"
				}, "正在读取完整历史…"));
				else if (hostState === "error") panel.push((0, react.createElement)("div", {
					key: "error",
					className: "dshm_error"
				}, `完整历史读取失败：${hostError ?? "未知错误"}（当前仅显示已加载窗口内的消息）`));
				if (filtered.length > 0) {
					const rows = filtered.map((it) => {
						const pending = pendingSeq === it.seq;
						const copied = copiedSeq === it.seq;
						const tagClass = pending ? "dshm_tagPending" : it.key ? "dshm_tagLoaded" : "dshm_tag";
						const tagText = pending ? "加载中…" : it.key ? "可定位" : "未加载";
						return (0, react.createElement)("li", {
							key: `m${it.seq}`,
							className: "dshm_row",
							title: it.text || "(无文本)"
						}, [
							(0, react.createElement)("span", {
								key: "t",
								className: "dshm_time"
							}, fmtTime(it.time)),
							(0, react.createElement)("span", {
								key: "x",
								className: "dshm_text",
								onClick: () => jumpTo(it)
							}, it.text || "(无文本)"),
							(0, react.createElement)("span", {
								key: "tag",
								className: tagClass,
								onClick: () => jumpTo(it)
							}, tagText),
							(0, react.createElement)("button", {
								key: "c",
								type: "button",
								className: "dshm_copy",
								title: copied ? "已复制" : "复制文本",
								onClick: (e) => doCopy(it, e)
							}, copied ? "✓" : "⧉")
						]);
					});
					panel.push((0, react.createElement)("ul", {
						key: "list",
						className: "dshm_list"
					}, rows));
				} else if (hostState !== "loading") panel.push((0, react.createElement)("div", {
					key: "empty",
					className: "dshm_empty"
				}, query.trim() ? "没有匹配的消息。" : "这个会话里还没有你发起的消息。"));
				if (hostState === "loaded" && Array.isArray(hostItems) && hostItems.length > items.length) panel.push((0, react.createElement)("div", {
					key: "more",
					className: "dshm_notice"
				}, `已显示全部 ${hostItems.length} 条你发送的消息；${hostItems.length - local.items.length} 条位于已加载窗口之外（点击可自动加载并定位，或先向上滚动加载）。`));
				if (notice) panel.push((0, react.createElement)("div", {
					key: "notice",
					className: "dshm_notice"
				}, notice));
				children.push((0, react.createElement)("div", {
					key: "panel",
					className: "dshm_panel"
				}, panel));
			}
			return (0, react.createElement)("div", { className: "dshm_root" }, children);
		}
		/** ------------------------------------------------------------------ plugin */
		/** Services required before mounting: the slot registry. */
		const inject = ["slots"];
		/**
		* Client plugin body: inject the stylesheet and register the dock row.
		* @param ctx - client plugin context (slots, sessions).
		*/
		function apply(ctx) {
			ctx.effect(() => injectStyles(), "dsh-history: stylesheet");
			const slots = ctx.get("slots");
			if (slots === void 0) return;
			const sessions = ctx.get("sessions");
			const loadOlderFor = sessions === void 0 ? void 0 : (id) => {
				const b = sessions.binding(id);
				if (b === void 0 || !b.session || typeof b.session.loadOlder !== "function") return Promise.resolve();
				return b.session.loadOlder();
			};
			slots.inject("conversation.input.dock", () => slots.register({
				name: "conversation.input.dock",
				id: "dsh-history",
				order: 30
			}, (props) => (0, react.createElement)(HistoryDock, {
				session: props.session,
				loadOlderFor
			})));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map