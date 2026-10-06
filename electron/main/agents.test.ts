import { describe, expect, it } from "vitest";
import type { Agent } from "@/ipc/bindings";
import { detect, KNOWN } from "./agents";

const known: Agent[] = [
	{ id: "a", name: "A", command: "a" },
	{ id: "b", name: "B", command: "b" },
	{ id: "c", name: "C", command: "c" },
];

const having = (...installed: string[]) => {
	const asked: string[] = [];
	const has = async (command: string) => {
		asked.push(command);
		return installed.includes(command);
	};
	return { has, asked };
};

describe("detect", () => {
	it("keeps the agents the machine has, in the order they are listed", async () => {
		const { has } = having("c", "a");
		expect(await detect(has, known)).toEqual([known[0], known[2]]);
	});

	it("answers with nothing when none is installed", async () => {
		const { has } = having();
		expect(await detect(has, known)).toEqual([]);
	});

	it("asks about each command once", async () => {
		const { has, asked } = having("a");
		await detect(has, known);
		expect(asked).toEqual(["a", "b", "c"]);
	});

	// The list is the feature: adding an agent is one entry, so an entry that
	// is missing a piece is an agent that can be offered and not started.
	it("gives every known agent a name and a command", () => {
		for (const agent of KNOWN) {
			expect(agent.id).toBeTruthy();
			expect(agent.name).toBeTruthy();
			expect(agent.command).toBeTruthy();
		}
		expect(new Set(KNOWN.map((agent) => agent.id)).size).toBe(KNOWN.length);
	});
});
