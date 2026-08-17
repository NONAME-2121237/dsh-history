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
import { type ReactElement } from 'react';
import type { Context } from 'cordis';
/** ------------------------------------------------------------------ types */
/** The client slots service face (structural subset used here). */
interface HistorySlotsService {
    inject(key: string, callback: () => () => void): () => void;
    register(options: {
        name: string;
        id?: string;
        order?: number;
    }, component: (props: HistoryDockProps) => ReactElement): () => void;
}
/** The client sessions service face (structural subset used here). */
interface HistorySessionsService {
    binding(id: string): {
        session: {
            loadOlder(): Promise<void>;
        };
    } | undefined;
}
/** The conversation snapshot slice this plugin reads (structural subset). */
interface HistoryConversationSnapshot {
    sessionId?: string;
    hasMore?: boolean;
    loadingOlder?: boolean;
    chat?: {
        nodes?: {
            values(): readonly HistoryChatNode[];
        };
    };
}
/** One materialized chat node (user or steering message). */
interface HistoryChatNode {
    kind?: string;
    key?: string;
    anchorSeq?: number;
    visibility?: string;
    data?: {
        seq?: number;
        time?: number;
        content?: readonly HistoryContentBlock[];
    };
}
/** One content block (structural subset: the text/image/tool shapes). */
interface HistoryContentBlock {
    type?: string;
    text?: string;
    name?: string;
}
/** Props the dock slot renders with. */
interface HistoryDockProps {
    session?: HistoryConversationSnapshot;
}
/** Timer service face (optional; used to auto-clear the copy feedback). */
interface HistoryTimer {
    timeout(callback: () => void, delay: number): () => void;
}
declare module 'cordis' {
    interface Context {
        slots: HistorySlotsService;
        sessions?: HistorySessionsService;
        timer?: HistoryTimer;
    }
}
/** ------------------------------------------------------------------ plugin */
/** Services required before mounting: the slot registry. */
export declare const inject: string[];
/**
 * Client plugin body: inject the stylesheet and register the dock row.
 * @param ctx - client plugin context (slots, sessions).
 */
export declare function apply(ctx: Context): void;
export {};
//# sourceMappingURL=index.d.ts.map