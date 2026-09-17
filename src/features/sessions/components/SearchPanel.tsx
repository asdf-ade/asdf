import {
	CaseSensitive,
	ChevronDown,
	ChevronRight,
	File as FileIcon,
	Regex,
	Search,
	WholeWord,
} from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import type { SearchLine, SearchOptions, SearchResult } from "@/ipc/bindings";
import { ipc } from "@/ipc/client";
import { cn } from "@/lib/utils";

/** How long the box stays quiet before the search runs. Long enough that a
 *  word is typed as one search, short enough not to feel held back. */
const SETTLE_MS = 220;

type State =
	| { status: "idle" }
	| { status: "searching" }
	| { status: "done"; result: SearchResult }
	| { status: "failed"; reason: string };

/**
 * Search, as an editor's panel does it: a query, the three toggles that change
 * how it is read, the globs that narrow where it looks, and the answers grouped
 * under the files they came from.
 *
 * It searches contents, not names. A name is not what anyone is looking for
 * when they open this — they are looking for where something is written — and
 * a name search is this search with the file list as its corpus.
 */
export function SearchPanel({
	cwd,
	onOpen,
	children,
}: {
	/** The folder to search: the terminal's, so it follows the shell. */
	cwd: string;
	onOpen: (path: string, line: number) => void;
	/** What the panel shows while the box is empty — the file tree. One box,
	 *  and the thing under it answers to what is in it. */
	children: ReactNode;
}) {
	const { t } = useTranslation();
	const [query, setQuery] = useState("");
	const [options, setOptions] = useState<SearchOptions>({
		matchCase: false,
		wholeWord: false,
		regex: false,
		include: "",
	});
	const [state, setState] = useState<State>({ status: "idle" });
	// The globs are folded away until asked for, the way an editor folds them:
	// most searches are the whole folder, and a second field standing open above
	// every result is a field in the way.
	const [showGlobs, setShowGlobs] = useState(false);
	const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
	// Which search the answers on screen belong to. A slow one that finishes
	// after a later one must not overwrite it, and there is no cancelling a
	// call that is already out.
	const latest = useRef(0);

	const needle = query.trim();

	useEffect(() => {
		if (!needle) {
			latest.current += 1;
			setState({ status: "idle" });
			return;
		}
		const mine = ++latest.current;
		setState({ status: "searching" });
		const timer = setTimeout(() => {
			void ipc.repoSearch(cwd, needle, options).then((answer) => {
				if (latest.current !== mine) return;
				setState(
					answer.ok
						? { status: "done", result: answer.value }
						: { status: "failed", reason: answer.error.message },
				);
			});
		}, SETTLE_MS);
		return () => clearTimeout(timer);
	}, [cwd, needle, options]);

	const toggle = (key: "matchCase" | "wholeWord" | "regex") =>
		setOptions((previous) => ({ ...previous, [key]: !previous[key] }));

	const summary = useMemo(() => {
		if (state.status !== "done") return null;
		const { matches, files, capped } = state.result;
		if (matches === 0) return t("session.search.none");
		return t(capped ? "session.search.cappedCount" : "session.search.count", {
			matches,
			files: files.length,
		});
	}, [state, t]);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex gap-1 border-b p-2">
				{/* The fold sits beside the query, not above the globs: it belongs to
				    the search as a whole, and putting it there is what keeps the two
				    fields on one axis when they are both open. */}
				<button
					type="button"
					aria-expanded={showGlobs}
					aria-label={t("session.search.toggleGlobs")}
					title={t("session.search.toggleGlobs")}
					onClick={() => setShowGlobs((previous) => !previous)}
					className={cn(
						"mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent/60",
						// A glob that is narrowing the search while folded away has to
						// say so, or the results are short for no reason anyone can see.
						options.include.trim()
							? "text-foreground"
							: "text-muted-foreground",
					)}
				>
					{showGlobs ? (
						<ChevronDown className="size-3.5" />
					) : (
						<ChevronRight className="size-3.5" />
					)}
				</button>

				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<div className="relative">
						<Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted-foreground" />
						<Input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("session.search.query")}
							aria-label={t("session.search.query")}
							className="h-8 bg-background/70 pr-20 pl-7 text-xs"
						/>
						{/* Inside the field, as an editor puts them: they change how what
					    is in the field is read, so they belong to it. */}
						<div className="absolute top-1.5 right-1 flex gap-0.5">
							<Toggle
								icon={CaseSensitive}
								on={options.matchCase}
								label={t("session.search.matchCase")}
								onClick={() => toggle("matchCase")}
							/>
							<Toggle
								icon={WholeWord}
								on={options.wholeWord}
								label={t("session.search.wholeWord")}
								onClick={() => toggle("wholeWord")}
							/>
							<Toggle
								icon={Regex}
								on={options.regex}
								label={t("session.search.regex")}
								onClick={() => toggle("regex")}
							/>
						</div>
					</div>

					{showGlobs && (
						<Input
							value={options.include}
							onChange={(event) =>
								setOptions((previous) => ({
									...previous,
									include: event.target.value,
								}))
							}
							placeholder={t("session.search.include")}
							aria-label={t("session.search.include")}
							className="h-7 bg-background/70 text-xs"
						/>
					)}
				</div>
			</div>

			{summary && (
				<p className="border-b px-3 py-1 text-[10px] text-muted-foreground">
					{summary}
				</p>
			)}

			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col",
					state.status !== "idle" && "overflow-auto p-1",
				)}
			>
				{state.status === "idle" ? (
					children
				) : state.status === "searching" ? (
					<Note>{t("session.search.searching")}</Note>
				) : state.status === "failed" ? (
					<Note>{state.reason}</Note>
				) : state.result.files.length === 0 ? null : (
					<ul>
						{state.result.files.map((file) => {
							const open = !folded.has(file.path);
							return (
								<li key={file.path}>
									<button
										type="button"
										aria-expanded={open}
										onClick={() =>
											setFolded((previous) => {
												const next = new Set(previous);
												if (!next.delete(file.path)) next.add(file.path);
												return next;
											})
										}
										className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs hover:bg-accent/60"
									>
										{open ? (
											<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
										) : (
											<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
										)}
										<FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
										{/* The name reads first and the folder behind it is the
										    thing that tells two of the same name apart. */}
										<span className="truncate">{baseName(file.path)}</span>
										<span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
											{dirName(file.path)}
										</span>
										<span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground tabular-nums">
											{file.lines.length}
										</span>
									</button>

									{open && (
										<ul>
											{file.lines.map((line) => (
												<li key={`${file.path}:${line.number}`}>
													<button
														type="button"
														onClick={() => onOpen(file.path, line.number)}
														className="flex w-full items-start gap-2 rounded-md py-0.5 pr-2 pl-7 text-left hover:bg-accent/60"
													>
														<span className="w-8 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
															{line.number}
														</span>
														<span className="min-w-0 flex-1 truncate font-mono text-[11px]">
															<Highlighted line={line} />
														</span>
													</button>
												</li>
											))}
										</ul>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}

/** The line, with the parts that matched lit. Leading whitespace goes: at this
 *  width an indented hit would be a row of blanks with the answer off the end. */
function Highlighted({ line }: { line: SearchLine }) {
	const trimmed = line.text.length - line.text.trimStart().length;
	const text = line.text.slice(trimmed);
	const ranges = line.ranges
		.map(([start, end]) => [start - trimmed, end - trimmed] as const)
		.filter(([, end]) => end > 0);

	const parts: { text: string; lit: boolean }[] = [];
	let at = 0;
	for (const [start, end] of ranges) {
		if (start > at) parts.push({ text: text.slice(at, start), lit: false });
		parts.push({ text: text.slice(Math.max(at, start), end), lit: true });
		at = Math.max(at, end);
	}
	parts.push({ text: text.slice(at), lit: false });

	return (
		<>
			{parts.map((part, index) =>
				part.text === "" ? null : (
					// The parts of one line, which have no identity of their own: the
					// line is keyed, and this order only changes when it does.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above
					<Fragment key={index}>
						{part.lit ? (
							<mark className="rounded-xs bg-amber-400/30 text-foreground">
								{part.text}
							</mark>
						) : (
							part.text
						)}
					</Fragment>
				),
			)}
		</>
	);
}

function Toggle({
	icon: Icon,
	on,
	label,
	onClick,
}: {
	icon: typeof CaseSensitive;
	on: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			aria-label={label}
			title={label}
			onClick={onClick}
			className={cn(
				"flex size-5 items-center justify-center rounded-sm transition-colors",
				on
					? "bg-accent text-foreground"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			<Icon className="size-3.5" />
		</button>
	);
}

function Note({ children }: { children: ReactNode }) {
	return <p className="px-2 py-3 text-muted-foreground text-xs">{children}</p>;
}

const baseName = (path: string) => path.split("/").pop() ?? path;
const dirName = (path: string) => path.split("/").slice(0, -1).join("/");
