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

// Two columns of text rather than one element per line: source lines have no
// identity of their own, and nothing here needs to style a single one.
export function SourceView({ lines }: { lines: string[] }) {
	return (
		<div className="flex gap-3 px-3 font-mono text-xs leading-6">
			<pre className="shrink-0 select-none text-right text-muted-foreground/60 tabular-nums">
				{lines.map((_, index) => index + 1).join("\n")}
			</pre>
			<pre className="whitespace-pre">{lines.join("\n")}</pre>
		</div>
	);
}
