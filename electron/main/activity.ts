/**
 * Which shells are working, decided from what they print.
 *
 * A session that is not on screen is not mounted in the renderer — only the
 * window of the session in front renders — so the renderer cannot watch a
 * background session at all. The pty registry here sees every shell whatever
 * the window shows, which is why the judgement lives in this process.
 *
 * The signal is the pty's own output: a shell is working while it writes, and
 * has finished once it has been quiet for a moment. That needs nothing from the
 * agent and no configuration from the user, which matters while a session is a
 * plain shell somebody typed `claude` into.
 *
 * ponytail: a command that works in silence — a long compile that prints
 * nothing, a `sleep` — reads as finished. The two exact signals are not
 * available yet: OSC 133 prompt marks need the user's shell to emit them, and
 * watching the agent's own process needs the agent to be the pty, which #33
 * decides. Swap this for one of those when either lands.
 */
export class Activity {
	private readonly quiet = new Map<number, ReturnType<typeof setTimeout>>();
	private readonly busy = new Set<number>();
	/** Sessions whose output is being ignored for a moment; see `mute`. */
	private readonly muted = new Map<number, ReturnType<typeof setTimeout>>();

	constructor(
		/** How long a shell must say nothing before its work counts as done. */
		private readonly quietMs: number,
		private readonly onChange: (id: number, busy: boolean) => void,
	) {}

	/**
	 * Stops counting this session's output as work for a while.
	 *
	 * Not everything a shell prints is work. Opening one prints a prompt, and
	 * resizing makes it repaint — which is what a person switching sessions
	 * causes, since the pane that comes on screen gets its size then. Both would
	 * otherwise spin the sidebar for a moment over nothing.
	 */
	mute(id: number, ms: number): void {
		const pending = this.muted.get(id);
		if (pending) clearTimeout(pending);
		const timer = setTimeout(() => this.muted.delete(id), ms);
		timer.unref?.();
		this.muted.set(id, timer);
	}

	/** Called for every chunk a session prints. */
	saw(id: number): void {
		if (this.muted.has(id)) return;
		const pending = this.quiet.get(id);
		if (pending) clearTimeout(pending);
		if (!this.busy.has(id)) {
			this.busy.add(id);
			this.onChange(id, true);
		}
		const timer = setTimeout(() => this.settle(id), this.quietMs);
		// Nothing here should hold the process open on its own.
		timer.unref?.();
		this.quiet.set(id, timer);
	}

	/**
	 * Drops a session that has gone. Silent on purpose: a closed session has no
	 * state left to report, and saying "finished" about one nobody can open
	 * would put an alert mark on a row that is no longer there.
	 */
	forget(id: number): void {
		const pending = this.quiet.get(id);
		if (pending) clearTimeout(pending);
		this.quiet.delete(id);
		const muted = this.muted.get(id);
		if (muted) clearTimeout(muted);
		this.muted.delete(id);
		this.busy.delete(id);
	}

	/** How many sessions are working, which is what the sleep blocker asks. */
	get working(): number {
		return this.busy.size;
	}

	private settle(id: number): void {
		this.quiet.delete(id);
		if (this.busy.delete(id)) this.onChange(id, false);
	}
}
