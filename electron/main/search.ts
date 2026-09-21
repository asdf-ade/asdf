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
/** How many names come back. A name result is one row, and a list longer than
 *  a panelful is not read — it is narrowed by typing more. */
const MAX_NAMES = 50;

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
 * The query as a JavaScript regular expression, under the options as typed.
 *
 * Null when the two dialects disagree — git's pattern is not JavaScript's, and
 * a pattern this cannot read is still a pattern git ran.
 */
function matcher(query: string, options: SearchOptions): RegExp | null {
	try {
		const source = options.regex
			? query
			: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(
			options.wholeWord ? `\\b(?:${source})\\b` : source,
			options.matchCase ? "" : "i",
		);
	} catch {
		return null;
	}
}

/**
 * Where in a line the matches are, for lighting them up.
 *
 * Worked out here rather than asked of git, which reports where a match starts
 * and never how long it is. Where the pattern cannot be read as JavaScript the
 * line simply comes back with no highlight, which is a worse result than the
 * right one and a much better one than the wrong one.
 */
export function rangesIn(
	text: string,
	query: string,
	options: SearchOptions,
): [number, number][] {
	const read = matcher(query, options);
	if (!read) return [];
	const pattern = new RegExp(read.source, `${read.flags}g`);

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

	return { files, matches, capped, names: [], namesCapped: false };
}

/**
 * The paths from `git ls-files -z` whose name the query matches.
 *
 * The same pattern the content search ran, read against the path rather than
 * against a line: a person who turns on "match case" means it for both halves,
 * and a regular expression is as good a way to name a file as any.
 */
export function pickNames(
	stdout: string,
	query: string,
	options: SearchOptions,
): Pick<SearchResult, "names" | "namesCapped"> {
	const pattern = matcher(query, options);
	if (!pattern) return { names: [], namesCapped: false };

	const names: SearchResult["names"] = [];
	// `--cached --others` lists a file that is both tracked and modified once,
	// but a path can still arrive twice; a name is one row whatever git says.
	for (const path of new Set(stdout.split("\0"))) {
		if (!path || !pattern.test(path)) continue;
		if (names.length >= MAX_NAMES) return { names, namesCapped: true };
		// Where in the path it matched, for the same highlight the lines get.
		names.push({ path, ranges: rangesIn(path, query, options) });
	}
	return { names, namesCapped: false };
}

const nothing: SearchResult = {
	files: [],
	matches: 0,
	capped: false,
	names: [],
	namesCapped: false,
};

/**
 * Searches the files under `cwd`: what is written in them, and what they are
 * called. One query, two answers, because knowing the file you want by name is
 * the ordinary case and it is the same typing either way.
 */
export async function search(
	cwd: string,
	query: string,
	options: SearchOptions,
): Promise<IpcResult<SearchResult>> {
	if (!query) return ok(nothing);
	const [found, named] = await Promise.all([
		contents(cwd, query, options),
		names(cwd, query, options),
	]);
	// A failure has something to say and the names cannot make up for it: a
	// folder that is not a repository has neither half to give.
	if (!found.ok) return found;
	return ok({ ...found.value, ...named });
}

/**
 * The names git knows, which is the repository's own list rather than the side
 * panel's tree — that one stops at 1500 entries and four levels down, and the
 * file you cannot find by eye is usually the one past that.
 *
 * `--others --exclude-standard` is the same stance the content search takes
 * with `--untracked`: the file someone just wrote counts, the ignored one does
 * not. A folder that is no repository answers with nothing rather than a
 * failure; the content search is already saying what is wrong.
 */
async function names(
	cwd: string,
	query: string,
	options: SearchOptions,
): Promise<Pick<SearchResult, "names" | "namesCapped">> {
	try {
		const { stdout } = await run(
			"git",
			[
				"ls-files",
				"--cached",
				"--others",
				"--exclude-standard",
				"-z",
				"--",
				...includePaths(options.include),
			],
			{
				cwd,
				maxBuffer: 64 * 1024 * 1024,
				env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
			},
		);
		return pickNames(stdout, query, options);
	} catch {
		return { names: [], namesCapped: false };
	}
}

/**
 * What is written in the files under `cwd`.
 *
 * Outside a repository there is no `git grep` to run, and the caller is told
 * that rather than handed an empty result — "nothing matched" and "nothing was
 * searched" are different answers and look the same.
 */
async function contents(
	cwd: string,
	query: string,
	options: SearchOptions,
): Promise<IpcResult<SearchResult>> {
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
			return ok(nothing);
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
