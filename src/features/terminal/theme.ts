import type { ITheme } from "@xterm/xterm";

/**
 * The emulator's palette, one per app theme.
 *
 * The surface colours are read from the app's own custom properties rather
 * than written down again here — a terminal a shade off the pane behind it is
 * exactly what copying them produces.
 *
 * The sixteen ANSI colours are ours, and do differ by theme. The default
 * palette is built for a dark terminal — its bright white is white, its yellow
 * is nearly so — and a shell that prints in them on a white background prints
 * nothing you can read. The light set is the same hues held to a contrast that
 * survives it.
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

/**
 * What a CSS custom property resolves to, as `#rrggbb`.
 *
 * xterm paints on a canvas and does its own colour parsing, which predates
 * `oklch()` — the notation src/index.css is written in. Reading `fillStyle`
 * back does not help: Chromium returns `oklch(...)` unchanged. So the colour is
 * actually painted onto a pixel and the pixel is read, which converts it to
 * sRGB the same way the screen will.
 */
function cssColor(name: string, fallback: string): string {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	if (!value) return fallback;
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) return fallback;
	// An unpaintable value leaves fillStyle alone, so seeding it with the
	// fallback is also how a failure is reported.
	context.fillStyle = fallback;
	context.fillStyle = value;
	context.fillRect(0, 0, 1, 1);
	const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
	const hex = (channel: number) => channel.toString(16).padStart(2, "0");
	return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

export function terminalTheme(dark: boolean): ITheme {
	const background = cssColor("--background", dark ? "#0a0a0a" : "#ffffff");
	const foreground = cssColor("--foreground", dark ? "#fafafa" : "#0a0a0a");
	return {
		background,
		foreground,
		cursor: foreground,
		cursorAccent: background,
		selectionBackground: dark ? "#ffffff40" : "#0969da33",
		...(dark ? ANSI_DARK : ANSI_LIGHT),
	};
}

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
