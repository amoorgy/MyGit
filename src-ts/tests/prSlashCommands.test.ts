import { describe, expect, it } from "vitest";
import { TOP_SLASH_COMMANDS } from "../tui/thoughtMap/slashCommands.js";

describe("PR slash command routing", () => {
    it("exposes /pr as direct inbox command (not submenu)", () => {
        const pr = TOP_SLASH_COMMANDS.find((c) => c.id === "pr");
        expect(pr).toBeDefined();
        expect(pr?.hasSubmenu).toBe(false);
    });
});

