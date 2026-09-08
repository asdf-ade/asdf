import { describe, expect, it } from "vitest";
import {
	closePane,
	type Layout,
	leaves,
	movePane,
	openPane,
	windowOf,
} from "./panes";
import type { Pane } from "./types";

const tab = (n: number): Pane => ({
	kind: "session",
	id: `session:s${n}`,
	sessionId: `s${n}`,
});

const twoTabs = () => openPane(windowOf(tab(1)), tab(2));

/** The tree with group ids replaced by the first tab each holds, so a test
 *  can state a whole layout in one literal. */
function shape(
	layout: Layout,
	groups: { id: string; panes: Pane[] }[],
): unknown {
	if (layout.kind === "leaf")
		return groups.find((g) => g.id === layout.group)?.panes[0]?.id ?? "";
	return {
		[layout.direction]: layout.children.map((child) => shape(child, groups)),
	};
}

describe("movePane", () => {
	it("splits a tab off to the right and focuses the new group", () => {
		const before = twoTabs();
		const [group] = before.groups;
		const after = movePane(before, "session:s2", {
			split: group.id,
			side: "right",
		});
		expect(shape(after.layout, after.groups)).toEqual({
			row: ["session:s1", "session:s2"],
		});
		expect(after.active).toBe(after.groups[1].id);
		expect(after.groups[0].activeId).toBe("session:s1");
	});

	it("splits to the left in front of the source", () => {
		const before = twoTabs();
		const after = movePane(before, "session:s2", {
			split: before.groups[0].id,
			side: "left",
		});
		expect(shape(after.layout, after.groups)).toEqual({
			row: ["session:s2", "session:s1"],
		});
	});

	it("splits top and bottom into a column", () => {
		const before = twoTabs();
		const below = movePane(before, "session:s2", {
			split: before.groups[0].id,
			side: "bottom",
		});
		expect(shape(below.layout, below.groups)).toEqual({
			column: ["session:s1", "session:s2"],
		});

		const above = movePane(before, "session:s2", {
			split: before.groups[0].id,
			side: "top",
		});
		expect(shape(above.layout, above.groups)).toEqual({
			column: ["session:s2", "session:s1"],
		});
	});

	it("nests a column inside a row when the direction changes", () => {
		let window = openPane(twoTabs(), tab(3));
		const [group] = window.groups;
		window = movePane(window, "session:s2", { split: group.id, side: "right" });
		const right = window.groups[1];
		window = movePane(window, "session:s3", {
			split: right.id,
			side: "bottom",
		});
		expect(shape(window.layout, window.groups)).toEqual({
			row: ["session:s1", { column: ["session:s2", "session:s3"] }],
		});
		expect(leaves(window.layout)).toEqual(window.groups.map((g) => g.id));
	});

	it("becomes a sibling when the split already runs that way", () => {
		let window = openPane(twoTabs(), tab(3));
		const [group] = window.groups;
		window = movePane(window, "session:s2", { split: group.id, side: "right" });
		window = movePane(window, "session:s3", {
			split: window.groups[1].id,
			side: "right",
		});
		expect(shape(window.layout, window.groups)).toEqual({
			row: ["session:s1", "session:s2", "session:s3"],
		});
	});

	it("does nothing when a lone tab splits off its own group", () => {
		const before = windowOf(tab(1));
		expect(
			movePane(before, "session:s1", {
				split: before.groups[0].id,
				side: "right",
			}),
		).toBe(before);
	});

	it("moving the last tab out of a group closes the group", () => {
		const before = twoTabs();
		const split = movePane(before, "session:s2", {
			split: before.groups[0].id,
			side: "right",
		});
		const [left, right] = split.groups;
		const merged = movePane(split, "session:s2", { group: left.id });
		expect(merged.groups).toHaveLength(1);
		expect(merged.groups[0].id).toBe(left.id);
		expect(merged.groups[0].activeId).toBe("session:s2");
		expect(merged.groups[0].id).not.toBe(right.id);
		expect(merged.layout).toEqual({ kind: "leaf", group: left.id });
	});

	it("collapses a split left with one child, and a nested one with it", () => {
		let window = openPane(twoTabs(), tab(3));
		const [group] = window.groups;
		window = movePane(window, "session:s2", { split: group.id, side: "right" });
		window = movePane(window, "session:s3", {
			split: window.groups[1].id,
			side: "bottom",
		});
		// Pull s3 back into the first group: the column is left with s2 alone
		// and folds into the row, which is then a plain two-column row.
		window = movePane(window, "session:s3", { group: group.id });
		expect(shape(window.layout, window.groups)).toEqual({
			row: ["session:s1", "session:s2"],
		});
	});
});

describe("closePane", () => {
	it("keeps one empty group when the last tab closes", () => {
		const after = closePane(windowOf(tab(1)), "session:s1");
		expect(after.groups).toHaveLength(1);
		expect(after.groups[0].panes).toEqual([]);
		expect(after.active).toBe(after.groups[0].id);
		expect(after.layout).toEqual({ kind: "leaf", group: after.groups[0].id });
	});

	it("drops a split whose last tab closed", () => {
		const before = twoTabs();
		const split = movePane(before, "session:s2", {
			split: before.groups[0].id,
			side: "right",
		});
		const after = closePane(split, "session:s2");
		expect(after.groups).toHaveLength(1);
		expect(after.active).toBe(after.groups[0].id);
		expect(after.layout.kind).toBe("leaf");
	});
});
