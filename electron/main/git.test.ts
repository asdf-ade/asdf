import { describe, expect, it } from "vitest";
import { repoName } from "./git";

describe("repoName", () => {
	it("takes the last segment and drops .git", () => {
		expect(repoName("https://github.com/asdf-ade/asdf.git")).toBe("asdf");
		expect(repoName("https://github.com/asdf-ade/asdf")).toBe("asdf");
	});

	it("reads an scp-style remote, which has no slash before the path", () => {
		expect(repoName("git@github.com:asdf-ade/asdf.git")).toBe("asdf");
	});

	it("ignores a trailing slash and surrounding space", () => {
		expect(repoName("  https://example.com/team/tools/  ")).toBe("tools");
	});

	it("keeps a name that only looks like an extension", () => {
		expect(repoName("https://example.com/team/dot.github")).toBe("dot.github");
	});

	// A name that is empty, or that would climb out of the folder the clone was
	// told to go in, is refused rather than cleaned up: there is no reading of
	// it that the person meant.
	it("refuses a url with no usable name", () => {
		expect(repoName("")).toBeNull();
		expect(repoName("   ")).toBeNull();
		expect(repoName("https://example.com/team/..")).toBeNull();
		expect(repoName("https://example.com/team/.git")).toBeNull();
	});
});
