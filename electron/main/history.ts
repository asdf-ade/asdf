// The repository's own history: what was committed, by whom, and what each
// commit touched. `git log` and `git show` do the reading; the only thing
// worked out here is the shape of the graph, which git does not hand over in a
// form a list can draw.
//
// Nothing imports `electron`, so the parsing is tested under plain Node.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedFile, Commit, DiffRow } from "@/ipc/bindings";
import { parseDiff } from "./repo";
import { fail, type IpcResult, ok } from "./result";

const run = promisify(execFile);

const git = async (cwd: string, ...args: string[]): Promise<string> => {
	const { stdout } = await run("git", args, {
		cwd,
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
	});
	return stdout;
};

/** Field and record separators. A subject can hold anything but these two. */
const FIELD = "\x1f";
const RECORD = "\x1e";

const FORMAT = ["%H", "%P", "%an", "%aI", "%D", "%s"].join(FIELD) + RECORD;

/** What `git log` is asked for. `--date-order` keeps the graph stable: a branch
 *  drawn one way on a page must be drawn the same way on the next. */
export function logArgs(limit: number): string[] {
	return [
		"log",
		"--date-order",
		`--max-count=${limit}`,
		`--pretty=format:${FORMAT}`,
	];
}

/**
 * The commits `git log` printed, each with the lane it sits in.
 *
 * Lanes are the graph: a commit's dot goes in its lane, and every other lane
 * still waiting for a commit draws a line past it. Assigned here because git
 * reports parents and nothing about shape.
 *
 * ponytail: straight lanes, no curves between them. A line that jumps lanes is
 * drawn as a dot in its new lane; at the width of the side panel the curve
 * would be two pixels of ornament. Draw the real edges when the view gets wide.
 */
export function parseLog(stdout: string): Commit[] {
	// Lane n is waiting for this commit; null means the lane is free.
	const lanes: (string | null)[] = [];
	const commits: Commit[] = [];

	for (const record of stdout.split(RECORD)) {
		const line = record.trim();
		if (!line) continue;
		const [hash, parents, author, date, refs, subject] = line.split(FIELD);
		if (!hash) continue;
		const parentList = parents ? parents.split(" ").filter(Boolean) : [];

		let lane = lanes.indexOf(hash);
		if (lane === -1) {
			lane = lanes.indexOf(null);
			if (lane === -1) lane = lanes.length;
		}
		// Everything else still waiting passes this row, which is what makes a
		// branch read as a line rather than a gap.
		const through = lanes
			.map((waiting, index) =>
				waiting !== null && index !== lane ? index : -1,
			)
			.filter((index) => index >= 0);

		lanes[lane] = parentList[0] ?? null;
		// A merge's other parents each need a lane of their own.
		for (const extra of parentList.slice(1)) {
			let free = lanes.indexOf(null);
			if (free === -1) free = lanes.length;
			lanes[free] = extra;
		}
		// Two lanes waiting for the same commit are one line from here down.
		for (let index = 0; index < lanes.length; index++) {
			const waiting = lanes[index];
			if (waiting !== null && lanes.indexOf(waiting) < index)
				lanes[index] = null;
		}

		commits.push({
			hash,
			parents: parentList,
			author: author ?? "",
			date: date ?? "",
			subject: subject ?? "",
			refs: parseRefs(refs ?? ""),
			lane,
			through,
		});
	}

	return commits;
}

/** `%D`: "HEAD -> main, origin/main, tag: v0.3.0". The arrow and the "tag:"
 *  are git saying what kind of ref it is; the name is what a row has room for. */
export function parseRefs(decoration: string): string[] {
	return decoration
		.split(", ")
		.map((ref) =>
			ref
				.trim()
				.replace(/^HEAD -> /, "")
				.replace(/^tag: /, ""),
		)
		.filter((ref) => ref.length > 0 && ref !== "HEAD");
}

/** `git show --numstat`: "added<TAB>removed<TAB>path", and a dash for a binary
 *  file, which has lines in neither sense. */
export function parseNumstat(stdout: string): Map<string, [number, number]> {
	const counts = new Map<string, [number, number]>();
	for (const line of stdout.split("\n")) {
		const [added, removed, ...rest] = line.split("\t");
		const path = rest.join("\t").trim();
		if (!path) continue;
		counts.set(path, [Number(added) || 0, Number(removed) || 0]);
	}
	return counts;
}

/** `git show --raw`: ":100644 100644 aaa bbb M<TAB>path", or two paths for a
 *  rename, where the one that matters is where the file ended up. */
export function parseRaw(
	stdout: string,
	counts: Map<string, [number, number]>,
): ChangedFile[] {
	const files: ChangedFile[] = [];
	for (const line of stdout.split("\n")) {
		if (!line.startsWith(":")) continue;
		const [meta, ...paths] = line.split("\t");
		const status = meta.trim().split(/\s+/).pop() ?? "";
		const path = (paths[paths.length - 1] ?? "").trim();
		if (!path) continue;
		const [added, removed] = counts.get(path) ?? [0, 0];
		files.push({
			path,
			kind:
				status.startsWith("A") || status.startsWith("C")
					? "added"
					: status.startsWith("D")
						? "deleted"
						: "modified",
			added,
			removed,
		});
	}
	return files;
}

/**
 * The newest `limit` commits of the repository `cwd` is in.
 *
 * Always from the top rather than from an offset: the lanes of a page depend on
 * every commit above it, so a page read on its own would draw a different graph
 * than the same commits read together. Reading more is asking for a bigger
 * `limit`, which is one `git log` either way.
 */
export async function history(
	cwd: string,
	limit: number,
): Promise<IpcResult<Commit[]>> {
	try {
		return ok(parseLog(await git(cwd, ...logArgs(limit))));
	} catch (thrown) {
		return fail(error(thrown));
	}
}

/** What one commit touched, with the lines it added and removed. */
export async function commitFiles(
	cwd: string,
	hash: string,
): Promise<IpcResult<ChangedFile[]>> {
	try {
		const [raw, numstat] = await Promise.all([
			git(cwd, "show", "--format=", "--raw", "--no-renames", hash),
			git(cwd, "show", "--format=", "--numstat", "--no-renames", hash),
		]);
		return ok(parseRaw(raw, parseNumstat(numstat)));
	} catch (thrown) {
		return fail(error(thrown));
	}
}

/** One commit's diff for one file. `--format=` so the message is not printed
 *  into the diff, where its indented lines would read as context. */
export async function commitDiff(
	cwd: string,
	hash: string,
	file: string,
): Promise<IpcResult<DiffRow[]>> {
	try {
		return ok(
			parseDiff(
				await git(cwd, "show", "--format=", "--no-renames", hash, "--", file),
			),
		);
	} catch (thrown) {
		return fail(error(thrown));
	}
}

function error(thrown: unknown) {
	const stderr =
		thrown && typeof thrown === "object" && "stderr" in thrown
			? String(thrown.stderr).trim()
			: "";
	return {
		kind: "tool" as const,
		message:
			stderr || (thrown instanceof Error ? thrown.message : String(thrown)),
	};
}
