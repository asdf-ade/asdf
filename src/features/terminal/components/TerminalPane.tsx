import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { match } from "ts-pattern";
import { useTerminalSession } from "../use-terminal-session";

export function TerminalPane({
	cwd,
	onSession,
}: {
	cwd: string | null;
	/** The pty id once the shell is up, null when it is not. */
	onSession?: (id: number | null) => void;
}) {
	const { t } = useTranslation();
	const host = useRef<HTMLDivElement | null>(null);
	const { session } = useTerminalSession(host, cwd);

	const ptyId = session.status === "running" ? session.id : null;
	useEffect(() => {
		onSession?.(ptyId);
	}, [ptyId, onSession]);

	return (
		<div className="relative min-h-0 overflow-hidden bg-background">
			{/* The emulator owns this element's children; never render into it. The
			    padding is on this element on purpose: the fit addon subtracts it
			    when sizing the grid, and what shows through it is `--background`,
			    which is what the emulator paints too — see ../theme.ts. */}
			<div ref={host} className="absolute inset-0 px-3 py-2" />

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
