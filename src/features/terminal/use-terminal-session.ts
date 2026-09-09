import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import {
	TERMINAL_EXIT_EVENT,
	TERMINAL_OUTPUT_EVENT,
	type TerminalOutput,
} from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { platform } from "@/ipc/platform";
import { isDark, terminalTheme, watchTheme } from "./theme";

export type SessionStatus =
	| { status: "starting" }
	| { status: "running"; id: number }
	| { status: "exited" }
	| { status: "failed"; reason: string };

/**
 * Owns the emulator instance and the pty behind it.
 *
 * The Terminal lives in a ref rather than in state on purpose: it is a
 * long-lived object with its own DOM, and putting it through React's render
 * cycle is how you end up destroying a running shell on an unrelated re-render.
 */
export function useTerminalSession(
	host: React.RefObject<HTMLDivElement | null>,
	/** Where the shell starts. Null falls back to the user's home. */
	cwd: string | null,
) {
	const [session, setSession] = useState<SessionStatus>({ status: "starting" });
	const terminal = useRef<Terminal | null>(null);

	useEffect(() => {
		const element = host.current;
		if (!element) return;

		let disposed = false;
		let sessionId: number | null = null;
		const cleanups: Array<() => void> = [];

		const term = new Terminal({
			cursorBlink: true,
			// A literal stack, not var(--font-mono): xterm measures glyphs on a
			// canvas, where a CSS custom property does not resolve and every cell
			// ends up the wrong width.
			fontFamily:
				"ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
			fontSize: 13,
			allowProposedApi: true,
			theme: terminalTheme(isDark()),
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(element);
		fit.fit();
		terminal.current = term;

		// The shell keeps running across a theme change, so the palette is
		// swapped under it rather than the emulator rebuilt.
		cleanups.push(
			watchTheme((dark) => {
				term.options.theme = terminalTheme(dark);
			}),
		);

		void (async () => {
			const opened = await ipc.openTerminal(cwd, term.cols, term.rows);
			if (disposed) return;
			if (!opened.ok) {
				setSession({ status: "failed", reason: opened.error.message });
				return;
			}
			const id = opened.value;
			sessionId = id;
			setSession({ status: "running", id });

			const unlisten = await platform.listen<TerminalOutput>(
				TERMINAL_OUTPUT_EVENT,
				(event) => {
					if (event.payload.id === id) term.write(event.payload.chunk);
				},
			);
			cleanups.push(unlisten);

			const unlistenExit = await platform.listen<number>(
				TERMINAL_EXIT_EVENT,
				(event) => {
					if (event.payload === id) {
						sessionId = null;
						setSession({ status: "exited" });
					}
				},
			);
			cleanups.push(unlistenExit);

			const typed = term.onData((data) => {
				void ipc.writeTerminal(id, data);
			});
			cleanups.push(() => typed.dispose());

			// The pty has to be told the new grid or full-screen programs like vim
			// draw to the wrong dimensions.
			const observer = new ResizeObserver(() => {
				fit.fit();
				void ipc.resizeTerminal(id, term.cols, term.rows);
			});
			observer.observe(element);
			cleanups.push(() => observer.disconnect());

			term.focus();
		})();

		return () => {
			disposed = true;
			for (const cleanup of cleanups) cleanup();
			if (sessionId !== null) void ipc.closeTerminal(sessionId);
			terminal.current?.dispose();
			terminal.current = null;
		};
	}, [host, cwd]);

	return { session };
}
