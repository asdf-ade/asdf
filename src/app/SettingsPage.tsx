import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { platform } from "@/ipc/platform";
import { cn } from "@/lib/utils";

export type Theme = "system" | "light" | "dark";

/** A part of settings, and what a link into settings points at. */
export type SettingsSection = "appearance" | "language";

const SECTIONS: SettingsSection[] = ["appearance", "language"];

const THEMES: Theme[] = ["system", "light", "dark"];

// The locales the app ships. Keep in step with src/app/i18n.ts.
const LOCALES = ["en", "ko", "zh-CN", "ja", "es", "pt-BR", "ru"] as const;

const LOCALE_NAMES: Record<(typeof LOCALES)[number], string> = {
	en: "English",
	ko: "한국어",
	"zh-CN": "中文",
	ja: "日本語",
	es: "Español",
	"pt-BR": "Português",
	ru: "Русский",
};

/**
 * Settings takes the whole window, so it comes in two pieces that sit where
 * the workspace sidebar and the panes sit: the sections replace the sidebar,
 * and the section itself replaces the panes. The panel is not there at all —
 * it describes the folder a session is in, and settings is not in one.
 *
 * Two components rather than one because the panes stay mounted between them:
 * a terminal pane ends its pty when it unmounts, so the panes are hidden in
 * place and settings is drawn around them.
 */
export function SettingsNav({
	section,
	onSection,
	onBack,
	width,
}: {
	section: SettingsSection;
	onSection: (section: SettingsSection) => void;
	onBack: () => void;
	width: number;
}) {
	const { t } = useTranslation();

	return (
		<div
			style={{ width }}
			className="flex shrink-0 flex-col border-r bg-muted/30"
		>
			{/* The window's top row. On macOS the traffic lights are in its left
			    end, so what is in it starts past them. */}
			<div
				className={cn(
					"drag-region flex h-9 shrink-0 items-center gap-1 px-1.5",
					platform.isMac && "pl-[88px]",
				)}
			>
				<Button
					variant="ghost"
					size="sm"
					onClick={onBack}
					className="h-7 gap-1 px-1.5 text-muted-foreground text-xs"
				>
					<ChevronLeft className="size-3.5" />
					{t("settings.back")}
				</Button>
			</div>

			<nav
				aria-label={t("settings.title")}
				className="min-h-0 flex-1 space-y-px overflow-y-auto p-1.5"
			>
				<p className="px-2 py-1 font-medium text-xs">{t("settings.title")}</p>
				{SECTIONS.map((item) => (
					<button
						key={item}
						type="button"
						aria-current={item === section ? "true" : undefined}
						onClick={() => onSection(item)}
						className={cn(
							"w-full rounded-md px-2 py-1 text-left text-xs",
							item === section
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
						)}
					>
						{t(`settings.sections.${item}`)}
					</button>
				))}
			</nav>
		</div>
	);
}

export function SettingsBody({
	section,
	theme,
	onTheme,
	trailing,
}: {
	section: SettingsSection;
	theme: Theme;
	onTheme: (theme: Theme) => void;
	/** The window's caption buttons, where the OS draws none of its own. With
	 *  the panel and the tab strips gone, this row is the window's top right. */
	trailing?: ReactNode;
}) {
	const { t, i18n } = useTranslation();

	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className="drag-region flex h-9 shrink-0 items-center border-b px-3">
				<span className="font-medium text-xs">
					{t(`settings.sections.${section}`)}
				</span>
				<span className="ml-2 truncate text-[11px] text-muted-foreground">
					{t("settings.subtitle")}
				</span>
				{trailing && (
					<div className="ml-auto flex self-stretch">{trailing}</div>
				)}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				<div className="flex max-w-md flex-col gap-4">
					{section === "appearance" ? (
						<fieldset className="flex flex-col gap-1.5">
							<legend className="font-medium text-xs">
								{t("settings.theme")}
							</legend>
							<div className="flex gap-1 rounded-lg bg-muted p-1">
								{THEMES.map((value) => (
									<button
										key={value}
										type="button"
										aria-pressed={theme === value}
										onClick={() => onTheme(value)}
										className={cn(
											"flex-1 rounded-md px-2 py-1.5 text-xs transition-colors",
											theme === value
												? "bg-background font-medium shadow-xs"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{t(`settings.themes.${value}`)}
									</button>
								))}
							</div>
						</fieldset>
					) : (
						<fieldset className="flex flex-col gap-1.5">
							<legend className="font-medium text-xs">
								{t("settings.language")}
							</legend>
							<div className="flex flex-wrap gap-1">
								{LOCALES.map((locale) => (
									<button
										key={locale}
										type="button"
										aria-pressed={i18n.resolvedLanguage === locale}
										onClick={() => void i18n.changeLanguage(locale)}
										className={cn(
											"rounded-md border px-2.5 py-1 text-xs transition-colors",
											i18n.resolvedLanguage === locale
												? "border-foreground bg-foreground text-background"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{LOCALE_NAMES[locale]}
									</button>
								))}
							</div>
						</fieldset>
					)}
				</div>
			</div>
		</div>
	);
}
