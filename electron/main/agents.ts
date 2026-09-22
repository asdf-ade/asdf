// Which coding agents this machine can start, found the way `agent-browser` is
// found: a command on PATH, and nothing else. The app never holds a key or
// signs anyone in — the agent does that itself, the way it does in a terminal.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Agent } from "@/ipc/bindings";

const run = promisify(execFile);

/**
 * The agents the app knows how to start.
 *
 * One entry is a name, the command that starts it, and that is the whole of
 * it — adding an agent is a line here. The names are the products' own, so
 * they are not translated: "Claude Code" is "Claude Code" in every locale, and
 * seven copies of the same string is a file to keep in step for nothing.
 */
export const KNOWN: Agent[] = [
	{ id: "claude", name: "Claude Code", command: "claude" },
	{ id: "codex", name: "Codex", command: "codex" },
	{ id: "gemini", name: "Gemini CLI", command: "gemini" },
	{ id: "opencode", name: "opencode", command: "opencode" },
	{ id: "cursor", name: "Cursor CLI", command: "cursor-agent" },
];

/**
 * The known agents this machine has, in the order above.
 *
 * `has` is injected so the list can be tested without a PATH to arrange, and
 * the lookups run together: five processes at startup, once.
 */
export async function detect(
	has: (command: string) => Promise<boolean>,
	known: Agent[] = KNOWN,
): Promise<Agent[]> {
	const found = await Promise.all(known.map((agent) => has(agent.command)));
	return known.filter((_, index) => found[index]);
}

/** Whether a command resolves on PATH. `where` on Windows, `which` elsewhere;
 *  both exit non-zero when there is nothing to report, which is the answer. */
export async function onPath(command: string): Promise<boolean> {
	try {
		const { stdout } = await run(
			process.platform === "win32" ? "where" : "which",
			[command],
			{ windowsHide: true },
		);
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}
