import { Fragment } from "react";
import { cn } from "@/lib/utils";
import type { DiffRow } from "../types";

// Before and after, with no header saying so — two columns of code next to each
// other already read as one.

const beforeTone: Record<DiffRow["kind"], string> = {
	same: "",
	add: "bg-muted/40",
	del: "bg-rose-500/10",
	change: "bg-rose-500/10",
};

const afterTone: Record<DiffRow["kind"], string> = {
	same: "",
	add: "bg-emerald-500/10",
	del: "bg-muted/40",
	change: "bg-emerald-500/10",
};

export function DiffView({ rows }: { rows: DiffRow[] }) {
	return (
		<div className="font-mono text-xs leading-6">
			<div className="grid w-max min-w-full grid-cols-2">
				{rows.map((row) => (
					<Row key={row.id} row={row} />
				))}
			</div>
		</div>
	);
}

function Row({ row }: { row: DiffRow }) {
	return (
		<>
			<Side
				className={cn("border-r", beforeTone[row.kind])}
				marker={row.kind === "del" || row.kind === "change" ? "-" : ""}
				line={row.before}
			/>
			<Side
				className={afterTone[row.kind]}
				marker={row.kind === "add" || row.kind === "change" ? "+" : ""}
				line={row.after}
			/>
		</>
	);
}

function Side({
	className,
	marker,
	line,
}: {
	className: string;
	marker: string;
	line?: { n: number; text: string };
}) {
	return (
		<div className={cn("flex gap-2 px-3", className)}>
			<span className="w-8 shrink-0 select-none text-right text-muted-foreground/60 tabular-nums">
				{line?.n ?? ""}
			</span>
			<span className="w-2 shrink-0 select-none text-muted-foreground">
				{marker}
			</span>
			<span className="whitespace-pre">{line?.text ?? ""}</span>
		</div>
	);
}

/** The height of one rendered line, in pixels — `leading-6`. Exported because
 *  scrolling to a line means multiplying by it, and two places guessing the
 *  same number is how they stop agreeing. */
export const LINE_HEIGHT = 24;

/** The line a search sent the reader to, and where on it the query matched. */
export type Mark = { line: number; ranges: [number, number][] };

// Two columns of text rather than one element per line: source lines have no
// identity of their own, and nothing here needs to style a single one. The
// marked line is the exception, and it is still one <pre> — the text around it
// is split in two and the line laid between them, so the layout is the same
// whether or not anything is lit.
export function SourceView({ lines, mark }: { lines: string[]; mark?: Mark }) {
	const at = mark && mark.line >= 1 && mark.line <= lines.length ? mark : null;
	return (
		<div className="flex gap-3 px-3 font-mono text-xs leading-6">
			<pre className="shrink-0 select-none text-right text-muted-foreground/60 tabular-nums">
				{lines.map((_, index) => index + 1).join("\n")}
			</pre>
			<pre className="whitespace-pre">
				{at ? (
					<>
						{lines.slice(0, at.line - 1).map((line) => `${line}\n`)}
						<span className="bg-amber-400/15">
							<Lit text={lines[at.line - 1]} ranges={at.ranges} />
						</span>
						{lines.slice(at.line).map((line) => `\n${line}`)}
					</>
				) : (
					lines.join("\n")
				)}
			</pre>
		</div>
	);
}

/** One line with the matched spans lit, the way the search panel lights them. */
function Lit({ text, ranges }: { text: string; ranges: [number, number][] }) {
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
					// line is where it is and this order changes only when it does.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above
					<Fragment key={index}>
						{part.lit ? (
							<mark className="rounded-xs bg-amber-400/40 text-foreground">
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
