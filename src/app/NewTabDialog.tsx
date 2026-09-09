import { Globe, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

/** What a new tab can be. */
export type TabKind = "terminal" | "browser";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPick: (kind: TabKind) => void;
};

const KINDS = [
	{ kind: "terminal", icon: SquareTerminal },
	{ kind: "browser", icon: Globe },
] as const;

/**
 * What `+` asks. Two things can go in a tab, and a second icon beside the plus
 * made the strip say that before anyone needed to know it; one button that asks
 * keeps the strip to one control and leaves room for a third kind later.
 */
export function NewTabDialog({ open, onOpenChange, onPick }: Props) {
	const { t } = useTranslation();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>{t("session.newTab.title")}</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-1">
					{KINDS.map(({ kind, icon: Icon }) => (
						<button
							key={kind}
							type="button"
							onClick={() => {
								onPick(kind);
								onOpenChange(false);
							}}
							className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted"
						>
							<Icon className="size-4 shrink-0 text-muted-foreground" />
							<span className="flex min-w-0 flex-col">
								<span className="text-sm">{t(`session.newTab.${kind}`)}</span>
								<span className="text-muted-foreground text-xs">
									{t(`session.newTab.${kind}Hint`)}
								</span>
							</span>
						</button>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
