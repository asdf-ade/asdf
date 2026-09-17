// Finding text in a folder's files, the way an editor's search panel does.
//
// `git grep` does the finding: it is already a dependency, it is fast, and it
// already knows which files are ignored — which is the whole difference between
// a search that answers in a blink and one that reads `node_modules` a thousand
// times. Nothing here imports `electron`, so the parsing is tested under Node.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppError, SearchOptions, SearchResult } from "@/ipc/bindings";
import { fail, type IpcResult, ok } from "./result";

const run = promisify(execFile);

/** How much comes back before the search says "and more". A one-letter query
 *  over a large repository is a walk of the whole tree into the renderer. */
const MAX_MATCHES = 2000;
const MAX_FILES = 500;

/**
 * The arguments `git grep` takes for one set of options.
 *
 * `-z` rather than the default: it separates the path and the line number with
 * NUL, so a path with a colon in it cannot be read as part of the line number.
 * `-I` skips binaries, which have no lines to show. `--untracked` covers the
 * file someone just wrote and has not added, which is exactly the file they are
 * most likely to be looking for.
 */
export function grepArgs(query: string, options: SearchOptions): string[] {
	return [
		"grep",
		"--no-color",
		"-I",
		"-z",
		"--line-number",
		"--untracked",
		options.regex ? "-E" : "-F",
		...(options.matchCase ? [] : ["-i"]),
		...(options.wholeWord ? ["-w"] : []),
		"-e",
		query,
		// Everything past this is a path, so a glob that starts with a dash is
		// still a glob.
		"--",
		...includePaths(options.include),
	];
}

/**
 * The globs typed into "files to include", as git pathspecs.
 *
 * Comma or whitespace separated, the way an editor's box takes them. A bare
 * `*.ts` means "anywhere", not "in this folder", which is what people mean by
 * it and not what git would do with it — so it is answered with `:(glob)` and a
 * leading `**` when the pattern has no slash of its own.
 */
export function includePaths(include: string): string[] {
	return include
		.split(/[,\s]+/)
		.map((pattern) => pattern.trim())
		.filter(Boolean)
		.map((pattern) =>
			pattern.includes("/") ? `:(glob)${pattern}` : `:(glob)**/${pattern}`,
		);
}

/**
 * Where in a line the matches are, for lighting them up.
 *
 * Worked out here rather than asked of git, which reports where a match starts
 * and never how long it is. The pattern is rebuilt as a JavaScript regular
 * expression under the same options; where the two dialects disagree the line
 * simply comes back with no highlight, which is a worse result than the right
 * one and a much better one than the wrong one.
 */
export function rangesIn(
	text: string,
	query: string,
	options: SearchOptions,
): [number, number][] {
	let pattern: RegExp;
	try {
		const source = options.regex
			? query
			: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		pattern = new RegExp(
			options.wholeWord ? `\\b(?:${source})\\b` : source,
			options.matchCase ? "g" : "gi",
		);
	} catch {
		return [];
	}

	const found: [number, number][] = [];
	for (const match of text.matchAll(pattern)) {
		if (match.index === undefined) continue;
		// A pattern that can match nothing would otherwise light up every gap
		// between characters, and there are more of those than characters.
		if (match[0].length === 0) continue;
		found.push([match.index, match.index + match[0].length]);
		if (found.length >= 100) break;
	}
	return found;
}

/**
 * `git grep -z --line-number` output: `path NUL line NUL text` per line.
 *
 * Grouped by file in the order git walked them, which is the repository's own
 * order and so is stable between searches — a list that reshuffles under a
 * keystroke cannot be read while it is being typed into.
 */
export function parseGrep(
	stdout: string,
	query: string,
	options: SearchOptions,
): SearchResult {
	const files: SearchResult["files"] = [];
	const byPath = new Map<string, SearchResult["files"][number]>();
	let matches = 0;
	let capped = false;

	for (const line of stdout.split("\n")) {
		if (!line) continue;
		const first = line.indexOf("\0");
		const second = line.indexOf("\0", first + 1);
		if (first === -1 || second === -1) continue;
		const path = line.slice(0, first);
		const number = Number(line.slice(first + 1, second));
		if (!Number.isFinite(number)) continue;

		let file = byPath.get(path);
		if (!file) {
			if (files.length >= MAX_FILES) {
				capped = true;
				break;
			}
			file = { path, lines: [] };
			byPath.set(path, file);
			files.push(file);
		}
		if (matches >= MAX_MATCHES) {
			capped = true;
			break;
		}
		const text = line.slice(second + 1);
		file.lines.push({
			number,
			// A line of minified JavaScript is one line and a megabyte; the panel
			// is 300 pixels wide and none of the rest of it can be read.
			text: text.length > 400 ? `${text.slice(0, 400)}…` : text,
			ranges: rangesIn(text, query, options),
		});
		matches += 1;
	}

	return { files, matches, capped };
}

/**
 * Searches the files under `cwd`.
 *
 * Outside a repository there is no `git grep` to run, and the caller is told
 * that rather than handed an empty result — "nothing matched" and "nothing was
 * searched" are different answers and look the same.
 */
export async function search(
	cwd: string,
	query: string,
	options: SearchOptions,
): Promise<IpcResult<SearchResult>> {
	if (!query) return ok({ files: [], matches: 0, capped: false });
	try {
		const { stdout } = await run("git", grepArgs(query, options), {
			cwd,
			maxBuffer: 64 * 1024 * 1024,
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		});
		return ok(parseGrep(stdout, query, options));
	} catch (thrown) {
		// git grep exits 1 for "no matches", which is an answer and not a
		// failure. Everything else — a bad pattern, no repository — is a failure
		// with something to say.
		if (
			thrown &&
			typeof thrown === "object" &&
			"code" in thrown &&
			thrown.code === 1
		)
			return ok({ files: [], matches: 0, capped: false });
		return fail(searchError(thrown));
	}
}

function searchError(thrown: unknown): AppError {
	const stderr =
		thrown && typeof thrown === "object" && "stderr" in thrown
			? String(thrown.stderr).trim()
			: "";
	return {
		kind: "tool",
		message:
			stderr || (thrown instanceof Error ? thrown.message : String(thrown)),
	};
}
