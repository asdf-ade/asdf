import { describe, expect, it } from "vitest";
import { nextOrdinal, siblingOf, successorOf } from "./roster";
import type { Session } from "./types";

const session = (id: string, projectId: string, ordinal: number): Session => ({
	id,
	projectId,
	ordinal,
});

/** Two workspaces, so the rules have a chance to reach across and must not. */
const roster = [
	session("a", "p1", 2),
	session("b", "p1", 1),
	session("c", "p2", 1),
];

describe("nextOrdinal", () => {
	it("starts at one in a workspace with no sessions", () => {
		expect(nextOrdinal([], "p1")).toBe(1);
		expect(nextOrdinal(roster, "p3")).toBe(1);
	});

	it("counts only its own workspace", () => {
		expect(nextOrdinal(roster, "p2")).toBe(2);
	});

	// The case that used to collide: closing session 1 leaves session 2, and
	// numbering from the count would name the next one 2 as well.
	it("goes past the highest, not past how many are left", () => {
		const afterClosingTheFirst = roster.filter((item) => item.id !== "b");
		expect(nextOrdinal(afterClosingTheFirst, "p1")).toBe(3);
	});
});

describe("siblingOf", () => {
	it("finds another session of the same workspace", () => {
		expect(siblingOf(roster, "a")?.id).toBe("b");
	});

	it("does not reach into another workspace", () => {
		expect(siblingOf(roster, "c")).toBeUndefined();
	});

	it("has nothing to say about a session that is not there", () => {
		expect(siblingOf(roster, "gone")).toBeUndefined();
	});
});

describe("successorOf", () => {
	it("stays in the workspace when it can", () => {
		expect(successorOf(roster, "a")?.id).toBe("b");
	});

	it("falls to whatever is left when the workspace had only this one", () => {
		expect(successorOf(roster, "c")?.id).toBe("a");
	});

	it("has no successor when it was the last session anywhere", () => {
		expect(successorOf([session("only", "p1", 1)], "only")).toBeUndefined();
	});
});
