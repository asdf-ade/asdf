import { describe, expect, it } from "vitest";
import {
	logArgs,
	parseLog,
	parseNumstat,
	parseRaw,
	parseRefs,
} from "./history";

const FIELD = "\x1f";
const RECORD = "\x1e";

/** One `git log --pretty` record: hash, parents, author, date, refs, subject. */
const row = (
	hash: string,
	parents: string,
	subject: string,
	refs = "",
	author = "Kim",
	date = "2026-09-23T10:00:00+09:00",
) => [hash, parents, author, date, refs, subject].join(FIELD) + RECORD;

describe("logArgs", () => {
	it("asks for a stable order, so a graph does not redraw itself", () => {
		expect(logArgs(50)).toContain("--date-order");
		expect(logArgs(50)).toContain("--max-count=50");
	});
});

describe("parseLog", () => {
	it("reads a straight history into one lane", () => {
		const commits = parseLog(
			[
				row("c", "b", "third"),
				row("b", "a", "second"),
				row("a", "", "first"),
			].join(""),
		);
		expect(commits.map((commit) => commit.hash)).toEqual(["c", "b", "a"]);
		expect(commits.map((commit) => commit.lane)).toEqual([0, 0, 0]);
		expect(commits.every((commit) => commit.through.length === 0)).toBe(true);
	});

	it("gives a branch its own lane and draws it past the commits beside it", () => {
		// m merges a side branch: m -> (main a, side s), s -> a.
		const commits = parseLog(
			[
				row("m", "a s", "merge"),
				row("s", "a", "on the branch"),
				row("a", "", "root"),
			].join(""),
		);
		expect(commits.map((commit) => commit.lane)).toEqual([0, 1, 0]);
		// While the side branch is drawn, the main line still passes its row.
		expect(commits[1].through).toEqual([0]);
	});

	it("frees a lane once two of them wait for the same commit", () => {
		const commits = parseLog(
			[
				row("m", "a s", "merge"),
				row("s", "a", "branch"),
				row("a", "r", "shared"),
				row("r", "", "root"),
			].join(""),
		);
		// Both lanes waited for `a`; from there down it is one line again.
		expect(commits[2].lane).toBe(0);
		expect(commits[2].through).toEqual([]);
		expect(commits[3].through).toEqual([]);
	});

	it("keeps the parents, which is what a commit's shape is made of", () => {
		const [merge] = parseLog(row("m", "a s", "merge"));
		expect(merge.parents).toEqual(["a", "s"]);
	});

	it("takes a subject with separators-looking text in it", () => {
		const [commit] = parseLog(row("a", "", "fix: a, b and c -> d"));
		expect(commit.subject).toBe("fix: a, b and c -> d");
	});

	it("has nothing to say about an empty repository", () => {
		expect(parseLog("")).toEqual([]);
	});
});

describe("parseRefs", () => {
	it("keeps the names and drops the words git uses to say what they are", () => {
		expect(parseRefs("HEAD -> main, origin/main, tag: v0.3.0")).toEqual([
			"main",
			"origin/main",
			"v0.3.0",
		]);
	});

	it("drops a bare HEAD, which names nothing a person is looking for", () => {
		expect(parseRefs("HEAD")).toEqual([]);
		expect(parseRefs("")).toEqual([]);
	});
});

describe("parseRaw", () => {
	const counts = parseNumstat(
		[
			"3\t1\tsrc/a.ts",
			"10\t0\tsrc/b.ts",
			"0\t4\tsrc/c.ts",
			"-\t-\tlogo.png",
		].join("\n"),
	);

	it("reads what happened to each file, with its line counts", () => {
		const files = parseRaw(
			[
				":100644 100644 aaa bbb M\tsrc/a.ts",
				":000000 100644 000 ccc A\tsrc/b.ts",
				":100644 000000 ddd 000 D\tsrc/c.ts",
			].join("\n"),
			counts,
		);
		expect(files).toEqual([
			{ path: "src/a.ts", kind: "modified", added: 3, removed: 1 },
			{ path: "src/b.ts", kind: "added", added: 10, removed: 0 },
			{ path: "src/c.ts", kind: "deleted", added: 0, removed: 4 },
		]);
	});

	// A binary file has lines in neither sense, and git says so with a dash.
	it("counts a binary file as nothing changed rather than NaN", () => {
		const files = parseRaw(":100644 100644 aaa bbb M\tlogo.png", counts);
		expect(files[0]).toEqual({
			path: "logo.png",
			kind: "modified",
			added: 0,
			removed: 0,
		});
	});

	it("ignores anything that is not a raw line", () => {
		expect(parseRaw("commit abcdef\n\n    a message\n", counts)).toEqual([]);
	});
});
