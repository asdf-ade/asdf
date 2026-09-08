import type {
	AppError,
	BrowserEndpoint,
	BrowserInfo,
	DiffRow,
	Issue,
	PullRequest,
	RepoSnapshot,
	WorkspaceInfo,
} from "./bindings";
import { bridge } from "./bridge";

export type IpcResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: AppError };

function toAppError(thrown: unknown): AppError {
	if (typeof thrown === "object" && thrown !== null && "kind" in thrown) {
		return thrown as AppError;
	}
	return { kind: "io", message: String(thrown) };
}

/**
 * Handlers in the main process already return an `IpcResult`, so the catch here
 * only covers the transport itself failing — a channel with no handler, or a
 * main process that has gone away.
 */
export async function call<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<IpcResult<T>> {
	try {
		return (await bridge.invoke(command, args)) as IpcResult<T>;
	} catch (thrown) {
		return { ok: false, error: toAppError(thrown) };
	}
}

export const ipc = {
	openWorkspace: (path: string) =>
		call<WorkspaceInfo>("open_workspace", { path }),
	openTerminal: (cwd: string | null, cols: number, rows: number) =>
		call<number>("open_terminal", { cwd, cols, rows }),
	writeTerminal: (id: number, data: string) =>
		call<void>("write_terminal", { id, data }),
	resizeTerminal: (id: number, cols: number, rows: number) =>
		call<void>("resize_terminal", { id, cols, rows }),
	closeTerminal: (id: number) => call<void>("close_terminal", { id }),
	/** Where the shell behind a terminal is right now; null when unknown. */
	terminalCwd: (id: number) => call<string | null>("terminal://cwd", { id }),
	repoSnapshot: (cwd: string) => call<RepoSnapshot>("repo://snapshot", { cwd }),
	repoDiff: (root: string, file: string) =>
		call<DiffRow[]>("repo://diff", { root, file }),
	repoRead: (dir: string, file: string) =>
		call<string[]>("repo://read", { dir, file }),
	repoRevert: (root: string, file: string) =>
		call<null>("repo://revert", { root, file }),
	repoCommit: (root: string, message: string) =>
		call<null>("repo://commit", { root, message }),
	repoIssues: (cwd: string) => call<Issue[]>("repo://issues", { cwd }),
	repoPulls: (cwd: string) => call<PullRequest[]>("repo://pulls", { cwd }),

	/** The main process holds the browser views; these are what a pane does. */
	browserEndpoint: () => call<BrowserEndpoint>("browser://endpoint"),
	browserOpen: (url: string) => call<BrowserInfo>("browser://open", { url }),
	browserPlace: (
		id: number,
		bounds: { x: number; y: number; width: number; height: number },
	) => call<null>("browser://place", { id, bounds }),
	browserNavigate: (id: number, url: string) =>
		call<null>("browser://navigate", { id, url }),
	browserGo: (id: number, where: "back" | "forward" | "reload") =>
		call<null>("browser://go", { id, where }),
	browserClose: (id: number) => call<null>("browser://close", { id }),
	/** Hide every browser view while a tab is dragged, so drop zones get the
	 *  pointer; native views sit above the DOM. */
	browserCover: (hidden: boolean) => call<null>("browser://cover", { hidden }),
};
