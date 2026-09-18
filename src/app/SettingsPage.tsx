import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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

type Props = {
	/** Which part is open. Settings is entered at a section, never "somewhere",
	 *  so a feature can send someone to its own. */
	section: SettingsSection;
	onSection: (section: SettingsSection) => void;
	onClose: () => void;
	theme: Theme;
	onTheme: (theme: Theme) => void;
};

/**
 * Settings, as a page in the window rather than a dialog over it.
 *
 * It was a modal, which is the wrong shape for a list that grows: it covered
 * the work, it could not be entered at a section, and — because a browser pane
 * is a native view drawn above the DOM — every pane had to be hidden while it
 * was up. Here it takes the place the panes were in, and the sidebar, the panel
 * and the status bar stay where they are.
 */
export function SettingsPage({
	section,
	onSection,
	onClose,
	theme,
	onTheme,
}: Props) {
	const { t, i18n } = useTranslation();

	return (
		<div className="flex min-w-0 flex-1 flex-col">
			{/* The same height as a tab strip, so the row the window drags by runs
			    unbroken across the top whatever is underneath it. */}
			<div className="drag-region flex h-9 shrink-0 items-center gap-2 border-b bg-muted/40 px-3">
				<span className="font-medium text-xs">{t("settings.title")}</span>
				<span className="truncate text-[11px] text-muted-foreground">
					{t("settings.subtitle")}
				</span>
				<Button
					size="icon"
					variant="ghost"
					aria-label={t("settings.close")}
					title={t("settings.close")}
					onClick={onClose}
					className="my-1.5 ml-auto size-6 shrink-0"
				>
					<X className="size-3.5" />
				</Button>
			</div>

			<div className="flex min-h-0 flex-1">
				<nav
					aria-label={t("settings.title")}
					className="w-40 shrink-0 space-y-px overflow-y-auto border-r p-1.5"
				>
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

				<div className="min-w-0 flex-1 overflow-y-auto p-4">
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
		</div>
	);
}
