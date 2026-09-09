import type { ITheme } from "@xterm/xterm";

/**
 * The emulator's palette, one per app theme.
 *
 * xterm paints on a canvas and cannot read a CSS custom property, so these are
 * literals rather than `var(--background)`. Background and foreground match
 * `--background` and `--foreground` in src/index.css; keep them in step.
 *
 * The sixteen ANSI colours are not the same in both. The default palette is
 * built for a dark terminal — its bright white is white, its yellow is nearly
 * so — and a shell that prints in them on a white background prints nothing you
 * can read. The light set is the same hues held to a contrast that survives it.
 */
const ANSI_DARK = {
	black: "#3f3f3f",
	red: "#f87171",
	green: "#4ade80",
	yellow: "#fbbf24",
	blue: "#60a5fa",
	magenta: "#c084fc",
	cyan: "#22d3ee",
	white: "#e5e5e5",
	brightBlack: "#6b6b6b",
	brightRed: "#fca5a5",
	brightGreen: "#86efac",
	brightYellow: "#fde047",
	brightBlue: "#93c5fd",
	brightMagenta: "#d8b4fe",
	brightCyan: "#67e8f9",
	brightWhite: "#fafafa",
} as const;

const ANSI_LIGHT = {
	black: "#1f2328",
	red: "#c0392b",
	green: "#1a7f37",
	yellow: "#9a6700",
	blue: "#0969da",
	magenta: "#8250df",
	cyan: "#106b74",
	white: "#6e7781",
	brightBlack: "#57606a",
	brightRed: "#a40e26",
	brightGreen: "#116329",
	brightYellow: "#7d4e00",
	brightBlue: "#0550ae",
	brightMagenta: "#6639ba",
	brightCyan: "#0e5a61",
	brightWhite: "#24292f",
} as const;

const DARK: ITheme = {
	background: "#252525",
	foreground: "#fafafa",
	cursor: "#fafafa",
	cursorAccent: "#252525",
	selectionBackground: "#ffffff40",
	...ANSI_DARK,
};

const LIGHT: ITheme = {
	background: "#ffffff",
	foreground: "#252525",
	cursor: "#252525",
	cursorAccent: "#ffffff",
	selectionBackground: "#0969da33",
	...ANSI_LIGHT,
};

export const terminalTheme = (dark: boolean): ITheme => (dark ? DARK : LIGHT);

/** Whether the app is currently in its dark theme, as the class says. */
export const isDark = () => document.documentElement.classList.contains("dark");

/**
 * Calls `onChange` whenever the app's theme flips. The class on `<html>` is the
 * one place that says which it is, so watching it needs no wiring through the
 * component tree.
 */
export function watchTheme(onChange: (dark: boolean) => void): () => void {
	const observer = new MutationObserver(() => onChange(isDark()));
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	return () => observer.disconnect();
}
