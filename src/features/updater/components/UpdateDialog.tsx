import { useTranslation } from "react-i18next";
import { match, P } from "ts-pattern";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { platform } from "@/ipc/platform";
import type { UpdateState } from "../types";

const RELEASES_URL = "https://github.com/asdf-ade/asdf/releases";

function formatBytes(bytes: number): string {
	const mb = bytes / 1024 / 1024;
	return `${mb.toFixed(1)} MB`;
}

type Props = {
	state: UpdateState;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDownload: (state: Extract<UpdateState, { status: "available" }>) => void;
	onInstallNow: (state: Extract<UpdateState, { status: "ready" }>) => void;
	onInstallOnQuit: (state: Extract<UpdateState, { status: "ready" }>) => void;
	onRetry: () => void;
};

export function UpdateDialog({
	state,
	open,
	onOpenChange,
	onDownload,
	onInstallNow,
	onInstallOnQuit,
	onRetry,
}: Props) {
	const { t } = useTranslation();

	const content = match(state)
		.with({ status: "available" }, (available) => (
			<>
				<DialogHeader>
					<DialogTitle>{t("update.available.title")}</DialogTitle>
					<DialogDescription>
						{t("update.available.current", {
							version: available.update.currentVersion,
						})}
					</DialogDescription>
				</DialogHeader>
				{/* The dialog body scrolls, not this box. A nested scroll container
				    would need its own tab stop to be keyboard-reachable; one scrolling
				    surface avoids that entirely. */}
				<section
					aria-label={t("update.available.notesLabel", {
						version: available.update.version,
					})}
					className="rounded-md border p-3 text-sm"
				>
					{available.update.body?.trim() || t("update.available.notesEmpty")}
				</section>
				<p className="text-muted-foreground text-sm">
					{t("update.available.safe")}
				</p>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("update.available.later")}
					</Button>
					<Button onClick={() => onDownload(available)}>
						{t("update.available.download")}
					</Button>
				</DialogFooter>
			</>
		))
		.with({ status: "downloading" }, ({ update, received, total }) => (
			<>
				<DialogHeader>
					<DialogTitle>
						{t("update.downloading.title", { version: update.version })}
					</DialogTitle>
				</DialogHeader>
				{total === null ? (
					<p className="text-muted-foreground text-sm">
						{t("update.downloading.pending")}
					</p>
				) : (
					<div className="flex flex-col gap-2">
						<Progress value={Math.round((received / total) * 100)} />
						<p className="text-muted-foreground text-sm">
							{t("update.downloading.progress", {
								received: formatBytes(received),
								total: formatBytes(total),
							})}
						</p>
					</div>
				)}
				<p className="text-muted-foreground text-sm">
					{t("update.downloading.keepsGoing")}
				</p>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("update.downloading.close")}
					</Button>
				</DialogFooter>
			</>
		))
		.with({ status: "ready" }, (ready) => (
			<>
				<DialogHeader>
					<DialogTitle>{t("update.ready.title")}</DialogTitle>
					<DialogDescription>
						{t("update.ready.body", { version: ready.update.version })}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="destructive" onClick={() => onInstallNow(ready)}>
						{t("update.ready.restartNow")}
					</Button>
					<Button onClick={() => onInstallOnQuit(ready)}>
						{t("update.ready.onQuit")}
					</Button>
				</DialogFooter>
			</>
		))
		.with({ status: "error", failure: "signature" }, () => (
			<>
				<DialogHeader>
					<DialogTitle>{t("update.error.titleBlocked")}</DialogTitle>
					<DialogDescription>{t("update.error.signature")}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("update.error.close")}
					</Button>
					{/* No retry. Retrying a failed signature check is what a tampered
					    download wants; send the user to the release page instead. */}
					<Button onClick={() => void platform.openExternal(RELEASES_URL)}>
						{t("update.error.openRelease")}
					</Button>
				</DialogFooter>
			</>
		))
		.with(
			{ status: "error", failure: P.union("offline", "download", "install") },
			(failed) => (
				<>
					<DialogHeader>
						<DialogTitle>{t("update.error.title")}</DialogTitle>
						<DialogDescription>
							{t(`update.error.${failed.failure}`, {
								version: failed.version ?? "",
							})}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							{t("update.error.close")}
						</Button>
						<Button onClick={onRetry}>{t("update.error.retry")}</Button>
					</DialogFooter>
				</>
			),
		)
		.otherwise(() => null);

	if (!content) return null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[80vh] overflow-y-auto">
				{content}
			</DialogContent>
		</Dialog>
	);
}
