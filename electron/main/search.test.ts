import { describe, expect, it } from "vitest";
import type { SearchOptions } from "@/ipc/bindings";
import { grepArgs, includePaths, parseGrep, rangesIn } from "./search";

const plain: SearchOptions = {
	matchCase: false,
	wholeWord: false,
	regex: false,
	include: "",
};

/** `git grep -z --line-number` writes `path NUL line NUL text` per line. */
const row = (path: string, line: number, text: string) =>
	`${path}\0${line}\0${text}`;

describe("grepArgs", () => {
	it("reads the query literally unless regex is on", () => {
		expect(grepArgs("a.b", plain)).toContain("-F");
		expect(grepArgs("a.b", { ...plain, regex: true })).toContain("-E");
		expect(grepArgs("a.b", { ...plain, regex: true })).not.toContain("-F");
	});

	it("folds case unless match case is on", () => {
		expect(grepArgs("x", plain)).toContain("-i");
		expect(grepArgs("x", { ...plain, matchCase: true })).not.toContain("-i");
	});

	it("asks for whole words only when that is on", () => {
		expect(grepArgs("x", plain)).not.toContain("-w");
		expect(grepArgs("x", { ...plain, wholeWord: true })).toContain("-w");
	});

	// Without `--`, a query that starts with a dash is read as an option, and
	// `-e` is what stops the pattern being one too.
	it("keeps the pattern and the paths on their own sides of --", () => {
		const args = grepArgs("-v", { ...plain, include: "*.ts" });
		expect(args[args.indexOf("-e") + 1]).toBe("-v");
		expect(args.indexOf("-e")).toBeLessThan(args.indexOf("--"));
		expect(args[args.length - 1]).toBe(":(glob)**/*.ts");
	});

	// A file someone just wrote and has not added is the one they are most
	// likely to be hunting for.
	it("searches untracked files and skips binaries", () => {
		expect(grepArgs("x", plain)).toContain("--untracked");
		expect(grepArgs("x", plain)).toContain("-I");
	});
});

describe("includePaths", () => {
	it("takes globs separated by commas or spaces", () => {
		expect(includePaths("*.ts, *.tsx")).toEqual([
			":(glob)**/*.ts",
			":(glob)**/*.tsx",
		]);
		expect(includePaths("*.ts *.md")).toHaveLength(2);
	});

	// "*.ts" means "anywhere" to a person and "here" to git.
	it("makes a pattern with no slash mean anywhere", () => {
		expect(includePaths("*.ts")).toEqual([":(glob)**/*.ts"]);
	});

	it("leaves a pattern that already has a slash where it is", () => {
		expect(includePaths("src/**/*.ts")).toEqual([":(glob)src/**/*.ts"]);
	});

	it("has nothing to say about an empty box", () => {
		expect(includePaths("")).toEqual([]);
		expect(includePaths("  ,  ")).toEqual([]);
	});
});

describe("rangesIn", () => {
	it("finds every match in the line, not just the first", () => {
		expect(rangesIn("a cat and a cat", "cat", plain)).toEqual([
			[2, 5],
			[12, 15],
		]);
	});

	it("reads the query literally unless regex is on", () => {
		expect(rangesIn("a.b and axb", "a.b", plain)).toEqual([[0, 3]]);
		expect(rangesIn("a.b and axb", "a.b", { ...plain, regex: true })).toEqual([
			[0, 3],
			[8, 11],
		]);
	});

	it("folds case unless match case is on", () => {
		expect(rangesIn("Cat", "cat", plain)).toEqual([[0, 3]]);
		expect(rangesIn("Cat", "cat", { ...plain, matchCase: true })).toEqual([]);
	});

	it("holds to word boundaries when whole word is on", () => {
		const options = { ...plain, wholeWord: true };
		expect(rangesIn("cat concat", "cat", options)).toEqual([[0, 3]]);
	});

	// A pattern that can match nothing would light up every gap between
	// characters, and there are more of those than there are characters.
	it("ignores a pattern that matches nothing at all", () => {
		expect(rangesIn("abc", "x*", { ...plain, regex: true })).toEqual([]);
	});

	// git and JavaScript do not read every pattern the same way. A line with no
	// highlight is a worse answer than the right one and a better one than a
	// highlight in the wrong place.
	it("gives up rather than throwing on a pattern JavaScript will not take", () => {
		expect(rangesIn("abc", "[", { ...plain, regex: true })).toEqual([]);
	});
});

describe("parseGrep", () => {
	it("groups lines under the file they came from, in git's order", () => {
		const result = parseGrep(
			[
				row("src/a.ts", 3, "const cat = 1;"),
				row("src/a.ts", 9, "// cat"),
				row("src/b.ts", 1, "cat"),
			].join("\n"),
			"cat",
			plain,
		);
		expect(result.files.map((file) => file.path)).toEqual([
			"src/a.ts",
			"src/b.ts",
		]);
		expect(result.files[0].lines.map((line) => line.number)).toEqual([3, 9]);
		expect(result.matches).toBe(3);
		expect(result.capped).toBe(false);
	});

	it("lights up where the match is", () => {
		const result = parseGrep(row("a.ts", 1, "const cat = 1;"), "cat", plain);
		expect(result.files[0].lines[0].ranges).toEqual([[6, 9]]);
	});

	// The separator is NUL precisely so a colon in a path cannot be read as the
	// end of it.
	it("reads a path with a colon in it", () => {
		const result = parseGrep(row("a:b.ts", 2, "cat"), "cat", plain);
		expect(result.files[0].path).toBe("a:b.ts");
		expect(result.files[0].lines[0].number).toBe(2);
	});

	it("keeps a line that is itself full of colons", () => {
		const result = parseGrep(row("a.ts", 1, "url: http://x/y:1"), "url", plain);
		expect(result.files[0].lines[0].text).toBe("url: http://x/y:1");
	});

	// One line of minified JavaScript is a megabyte, and the panel is 300
	// pixels wide.
	it("cuts a line too long to be read", () => {
		const result = parseGrep(
			row("a.js", 1, `${"x".repeat(900)}cat`),
			"cat",
			plain,
		);
		expect(result.files[0].lines[0].text).toHaveLength(401);
		expect(result.files[0].lines[0].text.endsWith("…")).toBe(true);
	});

	it("says so when it stopped counting rather than reporting a total", () => {
		const many = Array.from({ length: 2500 }, (_, index) =>
			row("a.ts", index + 1, "cat"),
		).join("\n");
		const result = parseGrep(many, "cat", plain);
		expect(result.capped).toBe(true);
		expect(result.matches).toBe(2000);
	});

	it("has nothing to say about nothing", () => {
		expect(parseGrep("", "cat", plain)).toEqual({
			files: [],
			matches: 0,
			capped: false,
		});
	});

	it("skips a line it cannot make sense of rather than failing", () => {
		const result = parseGrep(
			["garbage with no separators", row("a.ts", 1, "cat")].join("\n"),
			"cat",
			plain,
		);
		expect(result.files).toHaveLength(1);
	});
});
