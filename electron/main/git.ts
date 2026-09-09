import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fail, type IpcResult, ok } from "./result";

/**
 * The folder a clone of `url` would land in, which is what git itself would
 * pick: the last path segment, without `.git` and without any trailing slash.
 * Returns null for a URL with nothing usable in it, so the caller can say so
 * rather than clone into a directory called "".
 */
export function repoName(url: string): string | null {
	const trimmed = url.trim().replace(/\/+$/, "");
	if (!trimmed) return null;
	// scp-style remotes (git@host:owner/repo) have no slash before the path, so
	// take whatever follows the last slash or colon.
	const last = trimmed.split(/[/:]/).pop() ?? "";
	const name = last.replace(/\.git$/i, "");
	// A name git could not make a directory from, or one that would escape the
	// folder it was told to clone into.
	if (!name || name === "." || name === ".." || /[/\\]/.test(name)) return null;
	return name;
}

/** Whether a path is a directory with something already in it. */
function occupied(target: string): boolean {
	try {
		return readdirSync(target).length > 0;
	} catch {
		return false;
	}
}

/**
 * Clones `url` into a new folder under `parent` and answers with where it
 * landed.
 *
 * Git is asked for progress and prints it on stderr; every line goes to
 * `onLine` so the dialog can show what it is doing. A clone of anything large
 * is minutes of silence otherwise.
 */
export function clone(
	url: string,
	parent: string,
	onLine: (line: string) => void,
): Promise<IpcResult<{ path: string }>> {
	const name = repoName(url);
	if (!name) return Promise.resolve(fail({ kind: "io", message: `bad url` }));
	if (!existsSync(parent))
		return Promise.resolve(fail({ kind: "notFound", message: parent }));
	const target = path.join(parent, name);
	if (occupied(target))
		return Promise.resolve(fail({ kind: "io", message: `exists: ${target}` }));

	return new Promise((resolve) => {
		const child = spawn("git", ["clone", "--progress", url, target], {
			shell: process.platform === "win32",
			windowsHide: true,
		});
		// What git said last, kept so a failure can be reported in its own words
		// rather than as an exit code.
		let last = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			// Progress rewrites one line with carriage returns; split on both so
			// each rewrite is its own line rather than one growing one.
			for (const line of chunk.split(/[\r\n]+/)) {
				const text = line.trim();
				if (!text) continue;
				last = text;
				onLine(text);
			}
		});
		child.on("error", () =>
			// Nothing to run: the message names the cause, since "git failed" would
			// send someone looking at the URL.
			resolve(fail({ kind: "notFound", message: "git is not on PATH" })),
		);
		child.on("exit", (code) => {
			if (code === 0) resolve(ok({ path: target }));
			else resolve(fail({ kind: "io", message: last || `git exited ${code}` }));
		});
	});
}
