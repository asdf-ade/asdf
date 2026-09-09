// The contract between `electron/main` and the renderer. Both sides import this
// file, so there is nothing to keep in sync by hand.

export type WorkspaceInfo = {
	path: string;
	name: string;
	isGitRepo: boolean;
	/** The checkout's branch, or null outside a repository. */
	branch: string | null;
};

export type AppError =
	| { kind: "notFound"; message: string }
	| { kind: "notADirectory"; message: string }
	| { kind: "io"; message: string }
	| { kind: "terminal"; message: string }
	| { kind: "noSuchTerminal"; message: string }
	/** A git or gh invocation failed; the message is what it printed. */
	| { kind: "tool"; message: string };

export type TerminalOutput = {
	id: number;
	chunk: string;
};

/** What the main process knows about a pending release. */
export type UpdateInfo = {
	version: string;
	/** The version running right now, so the dialog can show both. */
	currentVersion: string;
	/** Release notes, as shown in the update dialog. */
	body: string | null;
};

/** Progress of an update download, as the renderer's `Update` facade sees it. */
export type DownloadProgress = {
	transferred: number;
	total: number | null;
};

/** Emitted for every chunk a session prints. */
export const TERMINAL_OUTPUT_EVENT = "terminal://output";

/** Emitted once with the session id when its shell has ended. */
export const TERMINAL_EXIT_EVENT = "terminal://exit";

/** Emitted while an update downloads. */
export const UPDATER_PROGRESS_EVENT = "updater://progress";

/**
 * Emitted for each line git prints while cloning. Git reports progress on
 * stderr and rewrites one line in place, so this is what it last said rather
 * than a running total: there is no total to have until it has counted.
 */
export const CLONE_PROGRESS_EVENT = "workspace://clone-progress";

/**
 * Emitted when the window is about to close. The renderer runs whatever it has
 * to do on the way out and then acknowledges, which is what actually closes it.
 */
export const WINDOW_CLOSE_REQUESTED_EVENT = "window://close-requested";

/** A browser view the main process holds for a pane. */
export type BrowserInfo = {
	id: number;
	url: string;
	title: string;
	canGoBack: boolean;
	canGoForward: boolean;
	loading: boolean;
	/** The agent-browser session pinned to this page, once the app has bound
	 *  one; an agent that uses it drives this pane and nothing else. */
	session: string | null;
};

/** How an agent reaches the app's browser views over CDP, once known. */
export type BrowserEndpoint = {
	/** `ws://127.0.0.1:<port>/devtools/browser/<id>`, or null when remote
	 *  debugging failed to start. */
	cdp: string | null;
	/** Whether `agent-browser` was found on PATH, so the pane can say so. */
	agentBrowser: boolean;
};

/** Emitted with a `BrowserInfo` whenever a browser view's page changes. */
export const BROWSER_STATE_EVENT = "browser://state";

// --- What the side panel shows about the folder a terminal is in -----------

/** Colour in the tree comes from git, the same way an editor does it. */
export type FileStatus = "clean" | "modified" | "added" | "deleted";

export type FileNode =
	| { kind: "dir"; name: string; path: string; children: FileNode[] }
	| { kind: "file"; name: string; path: string; status: FileStatus };

type ChangeKind = "added" | "modified" | "deleted";

/** One changed file, as `git status` and `git diff --numstat` report it. */
export type ChangedFile = {
	/** Relative to the repository root. */
	path: string;
	kind: ChangeKind;
	added: number;
	removed: number;
};

/** One side-by-side row. A missing side is a blank gutter, not an empty line. */
export type DiffRow = {
	/** Position in the hunk. A diff row has no other stable identity. */
	id: string;
	kind: "same" | "add" | "del" | "change";
	before?: { n: number; text: string };
	after?: { n: number; text: string };
};

export type Worktree = { path: string; branch: string | null };

/** Everything git says about a folder, in one read. */
export type RepoSnapshot = {
	cwd: string;
	/** The repository root, or null when the folder is not in one. */
	root: string | null;
	branch: string | null;
	ahead: number;
	behind: number;
	/** Files under `cwd`; paths relative to it. */
	tree: FileNode[];
	changes: ChangedFile[];
	worktrees: Worktree[];
};

export type Issue = {
	number: number;
	title: string;
	state: "open" | "closed";
	labels: string[];
	author: string;
	body: string;
};

export type PullRequest = {
	number: number;
	title: string;
	state: "open" | "draft" | "merged";
	branch: string;
	ci: "pass" | "fail" | "pending";
	reviewer?: string;
	body: string;
};
