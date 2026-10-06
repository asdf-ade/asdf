// What the machine's own terminal looks like, so the emulator can look like it
// rather than like something this app invented.
//
// Nothing here imports `electron`: it reads files and runs `plutil`, so the
// parsing can be tested under plain Node.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SystemTerminal } from "@/ipc/bindings";

/** `#rrggbb` from components in 0..1, which is how both platforms store them. */
function hex(...channels: number[]): string {
	return `#${channels
		.slice(0, 3)
		.map((channel) =>
			Math.round(Math.min(1, Math.max(0, channel)) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

// ---------------------------------------------------------------- macOS

/**
 * One value out of a plist, as `plutil` prints it raw.
 *
 * `raw` rather than `json`: com.apple.Terminal holds `data` at every colour,
 * and plutil refuses to write a plist containing data as JSON at all — even
 * when the value asked for is a string somewhere else in it.
 */
function plistValue(file: string, keyPath: string): string | null {
	try {
		return execFileSync(
			"plutil",
			["-extract", keyPath, "raw", "-o", "-", file],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
	} catch {
		return null;
	}
}

/** A dot in a profile name would read as another step down the key path. */
const escapeKey = (key: string) => key.replace(/\./g, "\\.");

/**
 * An `NSKeyedArchiver` blob, as the XML plutil converts it to.
 *
 * The blob is a binary plist inside a binary plist, and its colours carry an
 * ICC profile as data, so it cannot be asked for as JSON either. XML it is.
 */
function unarchive(base64: string): string | null {
	try {
		return execFileSync("plutil", ["-convert", "xml1", "-o", "-", "-"], {
			input: Buffer.from(base64, "base64"),
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
}

/** The `<data>` under `<key>name</key>`, decoded — the archives keep ASCII
 *  numbers in data, not in strings. */
function archivedData(xml: string, name: string): string | null {
	const found = xml.match(
		new RegExp(`<key>${name}</key>\\s*<data>([\\s\\S]*?)</data>`),
	);
	if (!found?.[1]) return null;
	// NUL-terminated, which would otherwise survive into the last number.
	return Buffer.from(found[1].replace(/\s+/g, ""), "base64")
		.toString("utf8")
		.replace(/\0/g, "")
		.trim();
}

/**
 * An `NSColor` out of its archive.
 *
 * Terminal writes a colour one of two ways and the archive says which. `NSRGB`
 * is the sRGB form, and it is present even when the profile was authored in
 * Display P3 — the wide-gamut components sit beside it under `NSComponents`,
 * which is the one to ignore, since the emulator paints in sRGB. `NSWhite` is
 * the greyscale form: one number, used for the plain blacks and whites.
 */
function archivedColor(base64: string): string | null {
	const xml = unarchive(base64);
	if (!xml) return null;

	const rgb = archivedData(xml, "NSRGB");
	if (rgb) {
		const parts = rgb.split(/\s+/).map(Number);
		if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite))
			return hex(...parts);
	}

	const white = archivedData(xml, "NSWhite");
	if (white) {
		const level = Number(white.split(/\s+/)[0]);
		if (Number.isFinite(level)) return hex(level, level, level);
	}
	return null;
}

/** The font out of an `NSFont` archive: its PostScript name and its size. */
function archivedFont(base64: string): { family: string; size: number } | null {
	const xml = unarchive(base64);
	if (!xml) return null;
	// `NSName` points at a string later in `$objects`; there is only one string
	// in a font archive that is not bookkeeping, so it is the one that is not
	// `$null` and not a class name.
	const strings = [...xml.matchAll(/<string>([^<]*)<\/string>/g)].map(
		(match) => match[1],
	);
	const family = strings.find(
		(value) =>
			value &&
			value !== "$null" &&
			value !== "NSFont" &&
			value !== "NSObject" &&
			value !== "NSKeyedArchiver",
	);
	const size = Number(
		xml.match(/<key>NSSize<\/key>\s*<real>([\d.]+)<\/real>/)?.[1],
	);
	if (!family) return null;
	return { family, size: Number.isFinite(size) && size > 0 ? size : 12 };
}

/**
 * The colour keys Terminal.app uses, in the order xterm wants its sixteen.
 *
 * `ANSIBrightBlackColor` and the rest of the bright half are a profile that
 * sets them; one that does not simply has no entry, and the caller falls back
 * for that one colour rather than for the palette.
 */
const MAC_ANSI = [
	"ANSIBlackColor",
	"ANSIRedColor",
	"ANSIGreenColor",
	"ANSIYellowColor",
	"ANSIBlueColor",
	"ANSIMagentaColor",
	"ANSICyanColor",
	"ANSIWhiteColor",
	"ANSIBrightBlackColor",
	"ANSIBrightRedColor",
	"ANSIBrightGreenColor",
	"ANSIBrightYellowColor",
	"ANSIBrightBlueColor",
	"ANSIBrightMagentaColor",
	"ANSIBrightCyanColor",
	"ANSIBrightWhiteColor",
] as const;

function readMacTerminal(home: string): SystemTerminal | null {
	const file = path.join(home, "Library/Preferences/com.apple.Terminal.plist");
	const name =
		plistValue(file, "Default Window Settings") ??
		plistValue(file, "Startup Window Settings");
	if (!name) return null;

	const profile = `Window Settings.${escapeKey(name)}`;
	const colorAt = (key: string) => {
		const blob = plistValue(file, `${profile}.${key}`);
		return blob ? archivedColor(blob) : null;
	};

	const fontBlob = plistValue(file, `${profile}.Font`);
	const ansi = MAC_ANSI.map(colorAt);
	return {
		source: name,
		font: fontBlob ? archivedFont(fontBlob) : null,
		background: colorAt("BackgroundColor"),
		foreground: colorAt("TextColor"),
		cursor: colorAt("CursorColor"),
		selection: colorAt("SelectionColor"),
		// All sixteen or none: a half-filled palette mixed with this app's own
		// would be a third palette that neither side chose.
		ansi: ansi.every((color): color is string => color !== null) ? ansi : null,
	};
}

// -------------------------------------------------------------- Windows

/** Windows Terminal writes `#rrggbb` already; anything else is not a colour. */
const asHex = (value: unknown): string | null =>
	typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : null;

type WindowsScheme = Record<string, unknown> & { name?: string };

const WINDOWS_ANSI = [
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"purple",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightPurple",
	"brightCyan",
	"brightWhite",
] as const;

/**
 * Windows Terminal's settings, which are JSON with comments in them — the
 * file ships with its own documentation inside it, and `JSON.parse` will not
 * have that. Stripping comments by regular expression is wrong for a comment
 * sequence inside a string, and a Windows path is full of backslashes that
 * make strings hard to scan, so strings are walked rather than matched.
 */
function parseJsonc(text: string): unknown {
	let out = "";
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			out += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			continue;
		}
		if (char === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			out += "\n";
			continue;
		}
		if (char === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i++;
			continue;
		}
		out += char;
	}
	// Trailing commas are legal in this file and not in JSON.
	return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export function readWindowsTerminal(text: string): SystemTerminal | null {
	let settings: Record<string, unknown>;
	try {
		settings = parseJsonc(text) as Record<string, unknown>;
	} catch {
		return null;
	}

	const profiles = settings.profiles as
		| { defaults?: Record<string, unknown>; list?: Record<string, unknown>[] }
		| undefined;
	const defaultGuid = settings.defaultProfile;
	const chosen =
		profiles?.list?.find((item) => item.guid === defaultGuid) ??
		profiles?.list?.[0];
	// A profile inherits whatever it does not say from `profiles.defaults`.
	const profile = { ...(profiles?.defaults ?? {}), ...(chosen ?? {}) };
	if (Object.keys(profile).length === 0) return null;

	const schemes = (settings.schemes as WindowsScheme[] | undefined) ?? [];
	const scheme =
		schemes.find((item) => item.name === profile.colorScheme) ?? undefined;

	const font = profile.font as { face?: unknown; size?: unknown } | undefined;
	const face = typeof font?.face === "string" ? font.face : null;
	const size = typeof font?.size === "number" ? font.size : null;

	const ansi = WINDOWS_ANSI.map((key) => asHex(scheme?.[key]));
	return {
		source:
			(typeof scheme?.name === "string" ? scheme.name : null) ??
			"Windows Terminal",
		font: face ? { family: face, size: size ?? 12 } : null,
		background: asHex(scheme?.background),
		foreground: asHex(scheme?.foreground),
		cursor: asHex(scheme?.cursorColor),
		selection: asHex(scheme?.selectionBackground),
		ansi: ansi.every((color): color is string => color !== null) ? ansi : null,
	};
}

function windowsSettingsPath(): string | null {
	const local = process.env.LOCALAPPDATA;
	if (!local) return null;
	return path.join(
		local,
		"Packages",
		"Microsoft.WindowsTerminal_8wekyb3d8bbwe",
		"LocalState",
		"settings.json",
	);
}

// ----------------------------------------------------------------- read

/**
 * The profile of the terminal this machine ships with, or null where there is
 * no one terminal to ask — every Linux desktop has a different one, and
 * guessing wrong is worse than not guessing.
 *
 * Read once per app run: it shells out, and a profile does not change under a
 * running app often enough to pay for that on every pane.
 */
export function readSystemTerminal(): SystemTerminal | null {
	try {
		if (process.platform === "darwin") return readMacTerminal(os.homedir());
		if (process.platform === "win32") {
			const file = windowsSettingsPath();
			if (!file) return null;
			return readWindowsTerminal(readFileSync(file, "utf8"));
		}
		return null;
	} catch {
		// A profile that cannot be read is the same as not having one: the app
		// paints with its own colours and opens either way.
		return null;
	}
}
