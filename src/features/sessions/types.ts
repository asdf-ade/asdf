export type {
	ChangedFile,
	DiffRow,
	FileNode,
	FileStatus,
	Issue,
	PullRequest,
	RepoSnapshot,
} from "@/ipc/bindings";

/** Where a changed file stands with the person reading it. */
export type ReviewState = "new" | "reviewed" | "reverted";

/** A terminal. Where it is comes from the shell itself, asked live. */
export type Session = {
	id: string;
	title: string;
	/** The workspace this terminal belongs to. */
	projectId: string;
};

/** A named set of terminals. Nothing on disk; the shells decide where they are. */
export type Project = {
	id: string;
	name: string;
};

/** A tab. Files belong to a terminal, whose folder they were opened from;
 *  issues and pull requests belong to the repository the terminal was in. */
export type Pane =
	| { kind: "session"; id: string; sessionId: string }
	| { kind: "file"; id: string; sessionId: string; dir: string; path: string }
	/** A live browser an agent drives. It belongs to the workspace, not to any
	 *  one terminal: agents come and go, and a page being read outlasts the
	 *  shell that opened it. */
	| { kind: "browser"; id: string; browserId: number }
	| { kind: "issue"; id: string; number: number }
	| { kind: "pull"; id: string; number: number };
