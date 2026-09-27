import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Commit } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { cn } from "@/lib/utils";

/** How many commits the panel opens with, and how many more each press adds.
 *  Enough to fill the column twice over, so the first scroll is free. */
const PAGE = 100;

/** The width of one lane, in pixels, and the gutter's padding either side. */
const LANE = 10;
const GUTTER = 6;

type State =
	| { status: "loading" }
	| { status: "done"; commits: Commit[] }
	| { status: "failed"; reason: string };

/**
 * The repository's history: the branch graph, and what each commit says.
 *
 * Read-only, and the whole of it is one `git log` — the lanes of a page only
 * make sense with every commit above it, so "more" is a bigger read rather than
 * a second one stitched on.
 */
export function HistoryPanel({
	cwd,
	activeHash,
	onOpen,
}: {
	/** The folder to read, which is the shell's, so it follows a `cd`. */
	cwd: string;
	/** The commit whose tab is on screen, lit in the list. */
	activeHash?: string;
	onOpen: (commit: Commit) => void;
}) {
	const { t } = useTranslation();
	const [limit, setLimit] = useState(PAGE);
	const [state, setState] = useState<State>({ status: "loading" });

	useEffect(() => {
		let alive = true;
		void ipc.repoHistory(cwd, limit).then((answer) => {
			if (!alive) return;
			setState(
				answer.ok
					? { status: "done", commits: answer.value }
					: { status: "failed", reason: answer.error.message },
			);
		});
		return () => {
			alive = false;
		};
	}, [cwd, limit]);

	if (state.status === "loading")
		return <Note>{t("session.files.loading")}</Note>;
	if (state.status === "failed") return <Note>{state.reason}</Note>;
	if (state.commits.length === 0)
		return <Note>{t("session.history.empty")}</Note>;

	// As wide as the busiest row needs, so the subjects line up down the column
	// rather than stepping in and out as branches come and go.
	const width =
		Math.max(
			...state.commits.map((commit) =>
				Math.max(commit.lane, ...commit.through, 0),
			),
		) + 1;

	return (
		<div className="min-h-0 flex-1 overflow-auto p-1">
			<ul>
				{state.commits.map((commit) => (
					<li key={commit.hash}>
						<button
							type="button"
							aria-current={commit.hash === activeHash ? "true" : undefined}
							onClick={() => onOpen(commit)}
							title={commit.subject}
							className={cn(
								"flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-xs",
								commit.hash === activeHash
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
							)}
						>
							<Graph commit={commit} width={width} />
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="flex min-w-0 items-center gap-1">
									{commit.refs.map((ref) => (
										<span
											key={ref}
											className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground"
										>
											{ref}
										</span>
									))}
									<span className="truncate text-foreground">
										{commit.subject}
									</span>
								</span>
								<span className="truncate text-[10px] text-muted-foreground">
									{commit.author} · {when(commit.date)}
								</span>
							</span>
						</button>
					</li>
				))}
			</ul>

			{/* A page that came back full is a page with more behind it. */}
			{state.commits.length >= limit && (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setLimit((previous) => previous + PAGE)}
					className="h-7 w-full justify-center text-muted-foreground text-xs"
				>
					{t("session.history.more")}
				</Button>
			)}
		</div>
	);
}

/**
 * One row of the graph: a dot in this commit's lane, and a line through every
 * lane that is still waiting for a commit further down.
 *
 * Drawn with elements rather than an SVG per row: at this size a lane is a
 * 1px rule and a 7px dot, and a row of divs costs less than a document.
 */
function Graph({ commit, width }: { commit: Commit; width: number }) {
	return (
		<span
			aria-hidden="true"
			className="relative shrink-0 self-stretch"
			style={{ width: width * LANE + GUTTER }}
		>
			{[commit.lane, ...commit.through].map((lane) => (
				<span
					key={lane}
					className="absolute top-0 bottom-0 w-px bg-border"
					style={{ left: GUTTER / 2 + lane * LANE + LANE / 2 }}
				/>
			))}
			<span
				className={cn(
					"absolute top-1/2 size-[7px] -translate-y-1/2 rounded-full border-2",
					// A merge is drawn hollow, the way a graph does it: it is the one
					// commit that is a join rather than a step.
					commit.parents.length > 1
						? "border-foreground bg-background"
						: "border-foreground bg-foreground",
				)}
				style={{ left: GUTTER / 2 + commit.lane * LANE + LANE / 2 - 3.5 }}
			/>
		</span>
	);
}

/** How long ago, in the units a person would say it in. */
function when(iso: string): string {
	const at = new Date(iso).getTime();
	if (Number.isNaN(at)) return iso;
	const minutes = Math.round((Date.now() - at) / 60_000);
	if (minutes < 60) return `${Math.max(minutes, 0)}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d`;
	return new Date(at).toISOString().slice(0, 10);
}

function Note({ children }: { children: React.ReactNode }) {
	return <p className="px-2 py-3 text-muted-foreground text-xs">{children}</p>;
}
