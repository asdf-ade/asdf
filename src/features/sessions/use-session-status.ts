import { useCallback, useEffect, useRef, useState } from "react";
import {
	NOTIFICATION_ACTIVATE_EVENT,
	TERMINAL_ACTIVITY_EVENT,
	type TerminalActivity,
} from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { platform } from "@/ipc/platform";

/**
 * What a session is doing, as the sidebar shows it.
 *
 * `done` is the one that carries the feature: work that finished while nobody
 * was looking at it. It is not a third kind of work, it is unread mail.
 */
export type SessionStatus = "idle" | "busy" | "done";

type Options = {
	/** Which pty each session holds, so an activity event can be placed. */
	ptys: Record<string, number>;
	/** The session on screen. Work finishing here, in a focused window, was
	 *  watched and raises nothing. */
	activeSessionId: string;
	/** What to call a session in its notification. */
	titleOf: (sessionId: string) => string;
	/** What the notification says. */
	body: string;
	/** Opening the session a clicked notification names. */
	onOpen: (sessionId: string) => void;
};

/**
 * Follows every session's shell, including the ones not on screen.
 *
 * The judgement is the main process's — only it sees a pty whose pane is not
 * mounted — and this turns the pty ids it reports into sessions, decides
 * whether anybody was watching, and asks for the notification when nobody was.
 */
export function useSessionStatus({
	ptys,
	activeSessionId,
	titleOf,
	body,
	onOpen,
}: Options): Record<string, SessionStatus> {
	const [status, setStatus] = useState<Record<string, SessionStatus>>({});
	// The listener is built once, so what it needs is read through a ref rather
	// than captured: rebuilding it on every render would drop events in the gap.
	const latest = useRef({ ptys, activeSessionId, titleOf, body, onOpen });
	latest.current = { ptys, activeSessionId, titleOf, body, onOpen };
	// A mirror of the state, so the listener can decide without reading state
	// inside an updater — an updater may run twice, and a notification is not
	// something to raise twice.
	const current = useRef<Record<string, SessionStatus>>({});

	useEffect(() => {
		const set = (sessionId: string, next: SessionStatus) => {
			current.current = { ...current.current, [sessionId]: next };
			setStatus(current.current);
		};

		const activity = platform.listen<TerminalActivity>(
			TERMINAL_ACTIVITY_EVENT,
			(event) => {
				const { ptys, activeSessionId, titleOf, body } = latest.current;
				const sessionId = Object.keys(ptys).find(
					(id) => ptys[id] === event.payload.id,
				);
				if (!sessionId) return;

				if (event.payload.busy) {
					set(sessionId, "busy");
					return;
				}
				// Only work that was seen to start is work that finished. Without
				// this a shell that prints its prompt at startup would announce a
				// job nobody ran.
				if (current.current[sessionId] !== "busy") return;

				const watching = sessionId === activeSessionId && document.hasFocus();
				if (!watching) void ipc.notify(sessionId, titleOf(sessionId), body);
				set(sessionId, watching ? "idle" : "done");
			},
		);

		const clicked = platform.listen<string>(
			NOTIFICATION_ACTIVATE_EVENT,
			(event) => latest.current.onOpen(event.payload),
		);

		return () => {
			void activity.then((off) => off());
			void clicked.then((off) => off());
		};
	}, []);

	/** Marks a session read, which is what clears its alert. */
	const markSeen = useCallback((sessionId: string) => {
		if (current.current[sessionId] !== "done") return;
		current.current = { ...current.current, [sessionId]: "idle" };
		setStatus(current.current);
	}, []);

	// Opening a session is reading it.
	useEffect(() => markSeen(activeSessionId), [activeSessionId, markSeen]);

	// So is coming back to the window while that session is already the one on
	// screen. Work finishes unwatched most often because the window was behind
	// something else, and clearing only on a switch left the bell ringing at a
	// session the person was looking straight at — with nothing to click but a
	// row that was already selected.
	useEffect(() => {
		const onFocus = () => markSeen(latest.current.activeSessionId);
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [markSeen]);

	return status;
}
