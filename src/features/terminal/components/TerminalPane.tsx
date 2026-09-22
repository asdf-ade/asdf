import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import { useTerminalSession } from "../use-terminal-session";

export function TerminalPane({
	cwd,
	startup,
	onSession,
}: {
	cwd: string | null;
	/** A command the shell runs as soon as it is up — the agent this session was
	 *  started as. Typed into the shell rather than spawned in its place, so
	 *  quitting the agent leaves a prompt in the same folder. */
	startup?: string;
	/** The pty id once the shell is up, null when it is not. */
	onSession?: (id: number | null) => void;
}) {
	const { t } = useTranslation();
	const host = useRef<HTMLDivElement | null>(null);
	const { session, surface } = useTerminalSession(host, cwd, startup);

	const ptyId = session.status === "running" ? session.id : null;
	useEffect(() => {
		onSession?.(ptyId);
	}, [ptyId, onSession]);

	return (
		// The emulator's own background, not the app's. The grid is whole cells
		// and the pane is not, so there is always a remainder — the padding, and
		// the strip below the last row. While the two colours agreed that
		// remainder was invisible; once the emulator started painting with the
		// machine's terminal profile it became a frame drawn around the terminal.
		// `--background` is the fallback, for a terminal that has not said yet.
		<div
			style={surface ? { backgroundColor: surface } : undefined}
			className="relative min-h-0 overflow-hidden bg-background"
		>
			{/* The inset is a wrapper, not padding on the host. The fit addon reads
			    the host's own box to size the grid and gets the subtraction wrong by
			    a few pixels, which spends the bottom padding and then some — the last
			    row sat past the pane's edge. With the host a plain box the grid fits
			    inside it. */}
			<div className="absolute inset-0 px-3 py-2">
				<div ref={host} className="h-full w-full" />
			</div>

			{match(session)
				.with({ status: "starting" }, () => (
					<p className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
						{t("terminal.starting")}
					</p>
				))
				.with({ status: "exited" }, () => (
					<p className="absolute right-0 bottom-0 left-0 border-t bg-background px-3 py-1 text-muted-foreground text-xs">
						{t("terminal.exited")}
					</p>
				))
				.with({ status: "failed" }, ({ reason }) => (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-4 text-center">
						<p className="text-sm">{t("terminal.failed")}</p>
						<p className="text-muted-foreground text-xs">{reason}</p>
					</div>
				))
				.otherwise(() => null)}
		</div>
	);
}
