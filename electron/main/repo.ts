import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
	AppError,
	ChangedFile,
	DiffRow,
	FileNode,
	FileStatus,
	Issue,
	PullRequest,
	RepoSnapshot,
	Worktree,
} from "@/ipc/bindings";
import { fail, type IpcResult, ok } from "./result";

// Everything here shells out to git and gh rather than reimplementing them:
// the panel shows what the user's own tools would say, and stays right when
// those tools change.

const run = promisify(execFile);

async function tool(
	cwd: string,
	command: string,
	args: string[],
): Promise<string> {
	const { stdout } = await run(command, args, {
		cwd,
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
	});
	return stdout;
}

const git = (cwd: string, ...args: string[]) => tool(cwd, "git", args);

function toolError(thrown: unknown): AppError {
	// execFile rejects with the process's stderr attached, which is the message
	// a person would want: "not a git repository", "gh: not logged in".
	const stderr =
		thrown && typeof thrown === "object" && "stderr" in thrown
			? String(thrown.stderr).trim()
			: "";
	const message =
		stderr || (thrown instanceof Error ? thrown.message : String(thrown));
	return { kind: "tool", message };
}

/** Where a running shell currently is, asked of the OS. Null when it cannot
 *  say — Windows has no cheap answer, so the caller keeps its last guess. */
export async function cwdOf(pid: number): Promise<string | null> {
	try {
		if (process.platform === "linux")
			return await import("node:fs/promises").then((fs) =>
				fs.readlink(`/proc/${pid}/cwd`),
			);
		if (process.platform === "darwin") {
			const out = await tool(process.cwd(), "lsof", [
				"-a",
				"-p",
				String(pid),
				"-d",
				"cwd",
				"-Fn",
			]);
			const line = out.split("\n").find((item) => item.startsWith("n"));
			return line ? line.slice(1) : null;
		}
	} catch {
		// Fall through: the process may have gone, or lsof may be missing.
	}
	// Windows has no cheap way to ask: the working directory lives in the
	// process's own PEB, and reading another process's PEB means native code.
	// The workspace's folder is what the panel falls back to there, so this
	// answering null is a smaller loss than it looks — it costs following a
	// `cd`, not knowing where the terminal is.
	return null;
}

// ponytail: 1 500 entries and 4 levels for a folder git does not track (a home
// directory, say), re-walked every poll; a real explorer would page and watch.
// Raise when someone opens a monorepo root and complains.
const TREE_LIMIT = 1500;
const TREE_DEPTH = 4;
const SKIP = new Set([".git", "node_modules", ".DS_Store"]);

// Breadth first, so the folder the shell is in is always listed whole and
// the cap only ever trims what is deep inside it.
async function walk(root: string): Promise<string[]> {
	const found: string[] = [];
	let level = [root];
	for (let depth = 0; depth <= TREE_DEPTH && level.length > 0; depth++) {
		const next: string[] = [];
		for (const dir of level) {
			const entries = await readdir(dir, { withFileTypes: true }).catch(
				() => [],
			);
			for (const entry of entries) {
				if (SKIP.has(entry.name)) continue;
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) next.push(full);
				else if (entry.isFile()) found.push(full);
			}
		}
		if (found.length >= TREE_LIMIT) break;
		level = next;
	}
	return found;
}

/** Files as a tree, folders first, the way every explorer sorts. */
export function buildTree(
	paths: string[],
	status: ReadonlyMap<string, FileStatus>,
): FileNode[] {
	type Dir = { dirs: Map<string, Dir>; files: string[] };
	const root: Dir = { dirs: new Map(), files: [] };
	for (const file of paths) {
		const parts = file.split("/");
		let node = root;
		for (const part of parts.slice(0, -1)) {
			let next = node.dirs.get(part);
			if (!next) {
				next = { dirs: new Map(), files: [] };
				node.dirs.set(part, next);
			}
			node = next;
		}
		node.files.push(parts[parts.length - 1]);
	}
	const emit = (node: Dir, prefix: string): FileNode[] => [
		...[...node.dirs]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, child]): FileNode => {
				const full = prefix ? `${prefix}/${name}` : name;
				return { kind: "dir", name, path: full, children: emit(child, full) };
			}),
		...node.files
			.sort((a, b) => a.localeCompare(b))
			.map((name): FileNode => {
				const full = prefix ? `${prefix}/${name}` : name;
				return {
					kind: "file",
					name,
					path: full,
					status: status.get(full) ?? "clean",
				};
			}),
	];
	return emit(root, "");
}

/** `git status --porcelain=v1 -z` → path (repo-relative) → what happened. */
export function parseStatus(porcelain: string): Map<string, FileStatus> {
	const out = new Map<string, FileStatus>();
	const entries = porcelain.split("\0");
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.length < 4) continue;
		const code = entry.slice(0, 2);
		const file = entry.slice(3);
		// A rename carries its old name in the next entry; skip it.
		if (code[0] === "R" || code[0] === "C") i++;
		if (code === "??" || code.includes("A")) out.set(file, "added");
		else if (code.includes("D")) out.set(file, "deleted");
		else out.set(file, "modified");
	}
	return out;
}

/** Unified diff → side-by-side rows. Only the hunks; headers are dropped. */
export function parseDiff(unified: string): DiffRow[] {
	const rows: DiffRow[] = [];
	let before = 0;
	let after = 0;
	let dels: string[] = [];
	let adds: string[] = [];
	const flush = () => {
		const n = Math.max(dels.length, adds.length);
		for (let i = 0; i < n; i++) {
			const del = dels[i];
			const add = adds[i];
			rows.push({
				id: `r${rows.length}`,
				kind:
					del !== undefined && add !== undefined
						? "change"
						: del !== undefined
							? "del"
							: "add",
				before:
					del !== undefined
						? { n: before - dels.length + i + 1, text: del }
						: undefined,
				after:
					add !== undefined
						? { n: after - adds.length + i + 1, text: add }
						: undefined,
			});
		}
		dels = [];
		adds = [];
	};
	for (const line of unified.split("\n")) {
		const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunk) {
			flush();
			before = Number(hunk[1]) - 1;
			after = Number(hunk[2]) - 1;
			continue;
		}
		if (line.startsWith("-") && !line.startsWith("---")) {
			before++;
			dels.push(line.slice(1));
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			after++;
			adds.push(line.slice(1));
		} else if (line.startsWith(" ")) {
			flush();
			before++;
			after++;
			rows.push({
				id: `r${rows.length}`,
				kind: "same",
				before: { n: before, text: line.slice(1) },
				after: { n: after, text: line.slice(1) },
			});
		}
	}
	flush();
	return rows;
}

function parseWorktrees(porcelain: string): Worktree[] {
	return porcelain
		.split("\n\n")
		.map((block) => {
			const dir = /^worktree (.+)$/m.exec(block)?.[1];
			const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
			return dir ? { path: dir, branch } : null;
		})
		.filter((item): item is Worktree => item !== null);
}

async function lineCount(file: string): Promise<number> {
	try {
		const text = await readFile(file, "utf8");
		return text.length === 0 ? 0 : text.split("\n").length;
	} catch {
		return 0;
	}
}

export async function snapshot(cwd: string): Promise<IpcResult<RepoSnapshot>> {
	try {
		if (!(await stat(cwd).catch(() => null))?.isDirectory())
			return fail({ kind: "notADirectory", message: cwd });

		// git prints forward slashes everywhere; the rest of the process, and
		// the paths the renderer sends back, are in the OS's own form.
		const root = await git(cwd, "rev-parse", "--show-toplevel")
			.then((out) => path.resolve(out.trim()))
			.catch(() => null);

		if (!root) {
			const files = await walk(cwd);
			const relative = files.map((file) =>
				path.relative(cwd, file).split(path.sep).join("/"),
			);
			return ok({
				cwd,
				root: null,
				branch: null,
				ahead: 0,
				behind: 0,
				tree: buildTree(relative, new Map()),
				changes: [],
				worktrees: [],
			});
		}

		const [branch, counts, porcelain, listed, numstat, worktrees] =
			await Promise.all([
				git(cwd, "rev-parse", "--abbrev-ref", "HEAD").then((out) => out.trim()),
				git(cwd, "rev-list", "--left-right", "--count", "HEAD...@{u}").catch(
					() => "0\t0",
				),
				git(cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"),
				git(cwd, "ls-files", "-z", "-co", "--exclude-standard", "."),
				git(cwd, "diff", "--numstat", "HEAD").catch(() => ""),
				git(cwd, "worktree", "list", "--porcelain").catch(() => ""),
			]);

		const [ahead, behind] = counts.trim().split(/\s+/).map(Number);
		const statusByRoot = parseStatus(porcelain);
		// The tree is rooted where the shell is; status paths are rooted at the
		// repository, so they are re-based before the two meet.
		const prefix = path.relative(root, cwd).split(path.sep).join("/");
		const statusHere = new Map<string, FileStatus>();
		for (const [file, state] of statusByRoot) {
			const local = prefix
				? file.startsWith(`${prefix}/`)
					? file.slice(prefix.length + 1)
					: null
				: file;
			if (local) statusHere.set(local, state);
		}
		const files = listed.split("\0").filter(Boolean);

		const stats = new Map<string, { added: number; removed: number }>();
		for (const line of numstat.split("\n")) {
			const [a, r, file] = line.split("\t");
			if (file)
				stats.set(file, { added: Number(a) || 0, removed: Number(r) || 0 });
		}
		const changes: ChangedFile[] = [];
		for (const [file, state] of statusByRoot) {
			const known = stats.get(file);
			changes.push({
				path: file,
				kind: state === "clean" ? "modified" : state,
				added:
					known?.added ??
					(state === "added" ? await lineCount(path.join(root, file)) : 0),
				removed: known?.removed ?? 0,
			});
		}

		return ok({
			cwd,
			root,
			branch: branch === "HEAD" ? null : branch,
			ahead: ahead || 0,
			behind: behind || 0,
			tree: buildTree(files, statusHere),
			changes: changes.sort((a, b) => a.path.localeCompare(b.path)),
			worktrees: parseWorktrees(worktrees),
		});
	} catch (thrown) {
		return fail(toolError(thrown));
	}
}

/** The change to one file as rows, or its whole content as additions when git
 *  has never seen it. `file` is repository-relative, like `changes` reports. */
export async function diff(
	root: string,
	file: string,
): Promise<IpcResult<DiffRow[]>> {
	try {
		const tracked = await git(root, "ls-files", "--error-unmatch", "--", file)
			.then(() => true)
			.catch(() => false);
		if (tracked)
			return ok(parseDiff(await git(root, "diff", "HEAD", "--", file)));
		const text = await readFile(path.join(root, file), "utf8");
		return ok(
			text.split("\n").map((line, index) => ({
				id: `r${index}`,
				kind: "add" as const,
				after: { n: index + 1, text: line },
			})),
		);
	} catch (thrown) {
		return fail(toolError(thrown));
	}
}

// ponytail: 2 MB cap, no encoding sniffing. A binary shows as garbage; an
// editor would detect it. Add when someone opens an image from the tree.
export async function read(
	dir: string,
	file: string,
): Promise<IpcResult<string[]>> {
	try {
		const full = path.join(dir, file);
		if ((await stat(full)).size > 2 * 1024 * 1024)
			return fail({ kind: "io", message: "too large" });
		return ok((await readFile(full, "utf8")).split("\n"));
	} catch (thrown) {
		return fail(toolError(thrown));
	}
}

export async function revert(
	root: string,
	file: string,
): Promise<IpcResult<null>> {
	try {
		await git(root, "checkout", "HEAD", "--", file);
		return ok(null);
	} catch (thrown) {
		return fail(toolError(thrown));
	}
}

export async function commit(
	root: string,
	message: string,
): Promise<IpcResult<null>> {
	try {
		await git(root, "add", "-A");
		await git(root, "commit", "-m", message);
		return ok(null);
	} catch (thrown) {
		return fail(toolError(thrown));
	}
}

type GhIssue = {
	number: number;
	title: string;
	state: string;
	labels: { name: string }[];
	author: { login: string };
	body: string;
};

type GhPull = {
	number: number;
	title: string;
	state: string;
	isDraft: boolean;
	headRefName: string;
	body: string;
	reviewRequests: { login?: string; name?: string }[];
	statusCheckRollup: { conclusion?: string; state?: string; status?: string }[];
};

export async function issues(cwd: string): Promise<IpcResult<Issue[]>> {
	try {
		const out = await tool(cwd, "gh", [
			"issue",
			"list",
			"--state",
			"open",
			"--limit",
			"50",
			"--json",
			"number,title,state,labels,author,body",
		]);
		return ok(
			(JSON.parse(out) as GhIssue[]).map((issue) => ({
				number: issue.number,
				title: issue.title,
				state: issue.state === "OPEN" ? "open" : "closed",
				labels: issue.labels.map((label) => label.name),
				author: issue.author.login,
				body: issue.body,
			})),
		);
	} catch (thrown) {
		return fail(toolError(thrown));
	}
}

function ciOf(checks: GhPull["statusCheckRollup"]): PullRequest["ci"] {
	if (!checks?.length) return "pass";
	const done = checks.map((check) => check.conclusion ?? check.state ?? "");
	if (done.some((state) => /FAIL|ERROR|CANCEL|TIMED_OUT/.test(state)))
		return "fail";
	if (checks.some((check) => check.status && check.status !== "COMPLETED"))
		return "pending";
	if (done.some((state) => state === "PENDING" || state === ""))
		return "pending";
	return "pass";
}

export async function pulls(cwd: string): Promise<IpcResult<PullRequest[]>> {
	try {
		const out = await tool(cwd, "gh", [
			"pr",
			"list",
			"--state",
			"open",
			"--limit",
			"50",
			"--json",
			"number,title,state,isDraft,headRefName,body,reviewRequests,statusCheckRollup",
		]);
		return ok(
			(JSON.parse(out) as GhPull[]).map((pull) => ({
				number: pull.number,
				title: pull.title,
				state:
					pull.state === "MERGED" ? "merged" : pull.isDraft ? "draft" : "open",
				branch: pull.headRefName,
				ci: ciOf(pull.statusCheckRollup),
				reviewer:
					pull.reviewRequests?.[0]?.login ?? pull.reviewRequests?.[0]?.name,
				body: pull.body,
			})),
		);
	} catch (thrown) {
		return fail(toolError(thrown));
	}
}
