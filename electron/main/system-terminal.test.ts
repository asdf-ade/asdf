import { describe, expect, it } from "vitest";
import { readWindowsTerminal } from "./system-terminal";

/** Windows Terminal's file, cut to the parts this reads, with the comments and
 *  the trailing comma it really ships with. */
const settings = `
{
    // The profile that opens in a new tab.
    "defaultProfile": "{61c54bbd-0001-0000-0000-000000000002}",
    "profiles":
    {
        "defaults":
        {
            "font": { "face": "Cascadia Mono", "size": 12 },
            "colorScheme": "Campbell"
        },
        "list":
        [
            {
                "guid": "{61c54bbd-0001-0000-0000-000000000001}",
                "name": "Windows PowerShell"
            },
            {
                /* The one \`defaultProfile\` names. */
                "guid": "{61c54bbd-0001-0000-0000-000000000002}",
                "name": "Command Prompt",
                "colorScheme": "One Half Dark",
                "font": { "face": "Consolas", "size": 14 },
            },
        ]
    },
    "schemes":
    [
        {
            "name": "One Half Dark",
            "background": "#282C34",
            "foreground": "#DCDFE4",
            "cursorColor": "#FFFFFF",
            "selectionBackground": "#FFFFFF",
            "black": "#282C34", "red": "#E06C75", "green": "#98C379",
            "yellow": "#E5C07B", "blue": "#61AFEF", "purple": "#C678DD",
            "cyan": "#56B6C2", "white": "#DCDFE4",
            "brightBlack": "#5A6374", "brightRed": "#E06C75",
            "brightGreen": "#98C379", "brightYellow": "#E5C07B",
            "brightBlue": "#61AFEF", "brightPurple": "#C678DD",
            "brightCyan": "#56B6C2", "brightWhite": "#DCDFE4"
        }
    ]
}
`;

describe("readWindowsTerminal", () => {
	it("reads the profile defaultProfile names, not the first in the list", () => {
		const read = readWindowsTerminal(settings);
		expect(read?.source).toBe("One Half Dark");
		expect(read?.font).toEqual({ family: "Consolas", size: 14 });
	});

	it("takes the colours from the scheme that profile chose", () => {
		const read = readWindowsTerminal(settings);
		expect(read?.background).toBe("#282C34");
		expect(read?.foreground).toBe("#DCDFE4");
		expect(read?.cursor).toBe("#FFFFFF");
		expect(read?.ansi).toHaveLength(16);
		expect(read?.ansi?.[1]).toBe("#E06C75");
		expect(read?.ansi?.[15]).toBe("#DCDFE4");
	});

	// The file documents itself in comments and ends its lists with a comma;
	// both are legal there and neither is JSON.
	it("survives the comments and trailing commas the real file has", () => {
		expect(readWindowsTerminal(settings)).not.toBeNull();
	});

	// A `//` inside a string is a path, not a comment. Cutting there would take
	// the rest of the line and leave the JSON unbalanced.
	it("does not mistake a URL or a path inside a string for a comment", () => {
		const read = readWindowsTerminal(`{
			"defaultProfile": "a",
			"profiles": { "list": [ { "guid": "a", "startingDirectory": "//server/share", "colorScheme": "S" } ] },
			"schemes": [ { "name": "S", "background": "#010203" } ]
		}`);
		expect(read?.background).toBe("#010203");
	});

	it("inherits what the profile does not say from profiles.defaults", () => {
		const read = readWindowsTerminal(`{
			"defaultProfile": "a",
			"profiles": {
				"defaults": { "font": { "face": "Cascadia Mono", "size": 11 }, "colorScheme": "S" },
				"list": [ { "guid": "a" } ]
			},
			"schemes": [ { "name": "S", "foreground": "#aabbcc" } ]
		}`);
		expect(read?.font).toEqual({ family: "Cascadia Mono", size: 11 });
		expect(read?.foreground).toBe("#aabbcc");
	});

	// Half a palette mixed with the app's own is a third palette nobody chose.
	it("gives up the whole palette when the scheme is missing a colour", () => {
		const read = readWindowsTerminal(`{
			"defaultProfile": "a",
			"profiles": { "list": [ { "guid": "a", "colorScheme": "S" } ] },
			"schemes": [ { "name": "S", "black": "#000000", "red": "#ff0000" } ]
		}`);
		expect(read?.ansi).toBeNull();
	});

	it("keeps the font when the profile names a scheme that is not there", () => {
		const read = readWindowsTerminal(`{
			"defaultProfile": "a",
			"profiles": { "list": [ { "guid": "a", "colorScheme": "Gone", "font": { "face": "Consolas" } } ] },
			"schemes": []
		}`);
		expect(read?.font).toEqual({ family: "Consolas", size: 12 });
		expect(read?.background).toBeNull();
		expect(read?.ansi).toBeNull();
	});

	it("answers with nothing rather than throwing on a file it cannot read", () => {
		expect(readWindowsTerminal("{ not json")).toBeNull();
		expect(readWindowsTerminal("")).toBeNull();
		expect(readWindowsTerminal("{}")).toBeNull();
	});
});
