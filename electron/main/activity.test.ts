import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity } from "./activity";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** The changes an Activity reported, as "id:busy" in the order they arrived. */
function watch(quietMs = 1000) {
	const changes: string[] = [];
	const activity = new Activity(quietMs, (id, busy) =>
		changes.push(`${id}:${busy}`),
	);
	return { activity, changes };
}

describe("Activity", () => {
	it("says a session started working on its first output", () => {
		const { activity, changes } = watch();
		activity.saw(1);
		expect(changes).toEqual(["1:true"]);
		expect(activity.working).toBe(1);
	});

	it("says nothing more while the session keeps writing", () => {
		const { activity, changes } = watch();
		activity.saw(1);
		vi.advanceTimersByTime(600);
		activity.saw(1);
		vi.advanceTimersByTime(600);
		activity.saw(1);
		expect(changes).toEqual(["1:true"]);
	});

	it("says it finished once it has been quiet long enough", () => {
		const { activity, changes } = watch();
		activity.saw(1);
		vi.advanceTimersByTime(999);
		expect(changes).toEqual(["1:true"]);
		vi.advanceTimersByTime(1);
		expect(changes).toEqual(["1:true", "1:false"]);
		expect(activity.working).toBe(0);
	});

	it("starts again when a finished session writes once more", () => {
		const { activity, changes } = watch();
		activity.saw(1);
		vi.advanceTimersByTime(1000);
		activity.saw(1);
		expect(changes).toEqual(["1:true", "1:false", "1:true"]);
	});

	it("keeps sessions apart", () => {
		const { activity, changes } = watch();
		activity.saw(1);
		vi.advanceTimersByTime(500);
		activity.saw(2);
		expect(activity.working).toBe(2);
		vi.advanceTimersByTime(500);
		// The first has been quiet for its full second; the second has not.
		expect(changes).toEqual(["1:true", "2:true", "1:false"]);
		expect(activity.working).toBe(1);
	});

	// Opening a shell prints a prompt and resizing makes it repaint. Neither is
	// work, and both would otherwise spin the sidebar over nothing — a resize
	// happens every time a session comes on screen.
	it("says nothing about output while a session is muted", () => {
		const { activity, changes } = watch();
		activity.mute(1, 500);
		activity.saw(1);
		activity.saw(1);
		expect(changes).toEqual([]);
		expect(activity.working).toBe(0);
	});

	it("counts output again once the mute has run out", () => {
		const { activity, changes } = watch();
		activity.mute(1, 500);
		vi.advanceTimersByTime(500);
		activity.saw(1);
		expect(changes).toEqual(["1:true"]);
	});

	it("muting one session leaves the others alone", () => {
		const { activity, changes } = watch();
		activity.mute(1, 500);
		activity.saw(1);
		activity.saw(2);
		expect(changes).toEqual(["2:true"]);
	});

	// A closed session has no state left to report, and an alert mark on a row
	// that is gone is worse than no mark at all.
	it("forgetting a session reports nothing and stops its timer", () => {
		const { activity, changes } = watch();
		activity.saw(1);
		activity.forget(1);
		expect(changes).toEqual(["1:true"]);
		expect(activity.working).toBe(0);
		vi.advanceTimersByTime(5000);
		expect(changes).toEqual(["1:true"]);
	});
});
