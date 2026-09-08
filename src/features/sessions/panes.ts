// The tabs of one project window and how they move between its splits. Pure,
// so the drag-and-drop rules can be checked without a DOM.
import type { Pane } from "./types";

/** One split of a window: a strip of tabs and the one that is showing. */
type PaneGroup = { id: string; panes: Pane[]; activeId: string };

/** Which edge of a group a tab is dropped towards. */
export type Side = "left" | "right" | "top" | "bottom";

/**
 * How the groups are arranged: a tree of rows and columns with a group at
 * each leaf. A row lays its children left to right, a column top to bottom,
 * and either may hold the other, which is what lets a terminal sit above a
 * browser that sits beside a file.
 */
export type Layout =
	| { kind: "leaf"; group: string }
	| { kind: "split"; direction: "row" | "column"; children: Layout[] };

/** A project is a window; its tabs live with it and nowhere else. A window
 *  is one group until a tab is dragged past the middle of a group's body,
 *  which splits it towards that edge. */
export type PaneWindow = {
	groups: PaneGroup[];
	layout: Layout;
	active: string;
};

/** Where a dragged tab lands: on another group's strip, or past the middle of
 *  a group's body, which opens a new group on that side of it. */
export type DropTarget = { group: string } | { split: string; side: Side };

let groupCount = 0;
const groupId = () => `pg${++groupCount}`;
const leaf = (group: string): Layout => ({ kind: "leaf", group });

export const emptyWindow = (): PaneWindow => {
	const id = groupId();
	return {
		groups: [{ id, panes: [], activeId: "" }],
		layout: leaf(id),
		active: id,
	};
};

/** A window holding just this tab. */
export const windowOf = (pane: Pane): PaneWindow => {
	const id = groupId();
	return {
		groups: [{ id, panes: [pane], activeId: pane.id }],
		layout: leaf(id),
		active: id,
	};
};

/** The groups in the order they appear on screen, reading each row left to
 *  right and each column top to bottom. */
export function leaves(layout: Layout): string[] {
	return layout.kind === "leaf"
		? [layout.group]
		: layout.children.flatMap(leaves);
}

const lastId = (panes: Pane[]) => panes[panes.length - 1]?.id ?? "";

const holderOf = (window: PaneWindow, paneId: string) =>
	window.groups.find((group) => group.panes.some((p) => p.id === paneId));

/**
 * Drops the groups that are not in `alive` from the tree. A split left with
 * one child becomes that child; a split whose child is a split the same way
 * absorbs it, so the tree never says "a row of one row".
 */
function prune(layout: Layout, alive: Set<string>): Layout | null {
	if (layout.kind === "leaf") return alive.has(layout.group) ? layout : null;
	const children = layout.children
		.map((child) => prune(child, alive))
		.filter((child): child is Layout => child !== null)
		.flatMap((child) =>
			child.kind === "split" && child.direction === layout.direction
				? child.children
				: [child],
		);
	if (children.length === 0) return null;
	if (children.length === 1) return children[0];
	return { ...layout, children };
}

/**
 * Puts `fresh` on `side` of `target`. Inside a split that already runs that
 * way it becomes a sibling; otherwise the target leaf is replaced by a split
 * the other way holding the two of them.
 */
function insertBeside(
	layout: Layout,
	target: string,
	fresh: string,
	side: Side,
): Layout {
	const direction = side === "left" || side === "right" ? "row" : "column";
	const before = side === "left" || side === "top";
	if (layout.kind === "leaf") {
		if (layout.group !== target) return layout;
		return {
			kind: "split",
			direction,
			children: before ? [leaf(fresh), layout] : [layout, leaf(fresh)],
		};
	}
	const at = layout.children.findIndex(
		(child) => child.kind === "leaf" && child.group === target,
	);
	if (at >= 0 && layout.direction === direction) {
		const children = [...layout.children];
		children.splice(before ? at : at + 1, 0, leaf(fresh));
		return { ...layout, children };
	}
	return {
		...layout,
		children: layout.children.map((child) =>
			insertBeside(child, target, fresh, side),
		),
	};
}

/** Drops empty groups; a window always keeps at least one. */
const compact = (
	groups: PaneGroup[],
	layout: Layout,
	active: string,
): PaneWindow => {
	const kept = groups.filter((group) => group.panes.length > 0);
	const final = kept.length > 0 ? kept : [groups[0]];
	const alive = new Set(final.map((group) => group.id));
	return {
		groups: final,
		layout: prune(layout, alive) ?? leaf(final[0].id),
		active: alive.has(active) ? active : final[final.length - 1].id,
	};
};

/** Open in the active group, or go to it where it is already open. */
export function openPane(window: PaneWindow, pane: Pane): PaneWindow {
	const holder = holderOf(window, pane.id);
	const target = holder?.id ?? window.active;
	return {
		...window,
		active: target,
		groups: window.groups.map((group) =>
			group.id !== target
				? group
				: {
						...group,
						panes: holder ? group.panes : [...group.panes, pane],
						activeId: pane.id,
					},
		),
	};
}

export function focusPane(window: PaneWindow, paneId: string): PaneWindow {
	const holder = holderOf(window, paneId);
	if (!holder) return window;
	return {
		...window,
		active: holder.id,
		groups: window.groups.map((group) =>
			group.id === holder.id ? { ...group, activeId: paneId } : group,
		),
	};
}

/** Closing the last tab of a split closes the split. */
export function closePane(window: PaneWindow, paneId: string): PaneWindow {
	const groups = window.groups.map((group) => {
		const panes = group.panes.filter((item) => item.id !== paneId);
		return {
			...group,
			panes,
			activeId: group.activeId === paneId ? lastId(panes) : group.activeId,
		};
	});
	return compact(groups, window.layout, window.active);
}

/** A dragged tab moves into another group, or past the middle of a body to
 *  open a new group on that side of it. A group left with no tabs closes. */
export function movePane(
	window: PaneWindow,
	paneId: string,
	drop: DropTarget,
): PaneWindow {
	const source = holderOf(window, paneId);
	const pane = source?.panes.find((item) => item.id === paneId);
	if (!source || !pane) return window;
	if ("group" in drop && drop.group === source.id) return window;
	// Splitting a lone tab off its own group would only rename the group.
	if ("split" in drop && drop.split === source.id && source.panes.length === 1)
		return window;

	const groups = window.groups.map((group) => {
		if (group.id !== source.id) return group;
		const panes = group.panes.filter((item) => item.id !== paneId);
		return {
			...group,
			panes,
			activeId: group.activeId === paneId ? lastId(panes) : group.activeId,
		};
	});

	if ("group" in drop) {
		return compact(
			groups.map((group) =>
				group.id === drop.group
					? { ...group, panes: [...group.panes, pane], activeId: paneId }
					: group,
			),
			window.layout,
			drop.group,
		);
	}

	const fresh: PaneGroup = { id: groupId(), panes: [pane], activeId: paneId };
	return compact(
		[...groups, fresh],
		insertBeside(window.layout, drop.split, fresh.id, drop.side),
		fresh.id,
	);
}
