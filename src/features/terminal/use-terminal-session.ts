import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import {
	type SystemTerminal,
	TERMINAL_EXIT_EVENT,
	TERMINAL_OUTPUT_EVENT,
	type TerminalOutput,
} from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { platform } from "@/ipc/platform";
import { isDark, terminalTheme, watchTheme } from "./theme";

/**
 * The machine's terminal profile, asked for once for the whole app.
 *
 * A promise rather than state: every pane wants the same answer, it never
 * changes while the app runs, and a pane that opens before the answer arrives
 * would otherwise paint in the app's colours and then flash into the system's.
 */
let systemProfile: Promise<SystemTerminal | null> | null = null;
const askSystemProfile = () => {
	systemProfile ??= ipc
		.systemTerminal()
		.then((result) => (result.ok ? result.value : null));
	return systemProfile;
};

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
	// What the emulator is painting its background with. The pane behind it has
	// to use the same colour: the grid never fills the pane exactly, so whatever
	// the pane is drew a frame around the terminal the moment the two stopped
	// agreeing — which is what reading the system profile made happen.
	const [surface, setSurface] = useState<string | null>(null);
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
			theme: terminalTheme(isDark(), null),
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(element);
		fit.fit();
		terminal.current = term;

		/** Repaints the emulator, and tells the pane behind it what colour to be. */
		const paint = (dark: boolean, profile: SystemTerminal | null) => {
			const theme = terminalTheme(dark, profile);
			term.options.theme = theme;
			setSurface(theme.background ?? null);
		};
		paint(isDark(), null);

		// The machine's profile, once it is known. The shell is already running
		// by then, so the palette is swapped under it rather than the emulator
		// rebuilt — the same move a theme change makes.
		let system: SystemTerminal | null = null;
		void askSystemProfile().then((profile) => {
			if (disposed) return;
			system = profile;
			paint(isDark(), system);
			if (profile?.font) {
				term.options.fontFamily = `"${profile.font.family}", ui-monospace, monospace`;
				term.options.fontSize = profile.font.size;
			}
			fit.fit();
		});

		// A theme change repaints the pane, but only what the app owns. Where
		// the system profile answered, its colours stay put: someone's terminal
		// does not turn light because this window did.
		cleanups.push(
			watchTheme((dark) => {
				paint(dark, system);
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
			//
			// A tab that is not showing is hidden rather than unmounted, so it
			// measures zero and the fit would tell the shell it has no screen —
			// which is what reflows a full-screen program into one column and
			// leaves it that way when the tab comes back. A box with no size is
			// not a new grid; it is the absence of one, so it is ignored.
			const observer = new ResizeObserver(() => {
				if (element.clientWidth === 0 || element.clientHeight === 0) return;
				fit.fit();
				if (term.cols === 0 || term.rows === 0) return;
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

	return { session, surface };
}
