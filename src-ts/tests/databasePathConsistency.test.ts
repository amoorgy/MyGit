import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, vi } from "vitest";

let openedPath = "";

vi.mock("bun:sqlite", () => {
    class FakeDatabase {
        constructor(dbPath: string) {
            openedPath = dbPath;
        }
        run() {}
        query() {
            return {
                run() {},
                all() {
                    return [];
                },
                get() {
                    return null;
                },
            };
        }
        close() {}
    }

    return { Database: FakeDatabase };
});

describe("project DB path consistency", () => {
    it("openProjectDatabase resolves to .mygit/mygit.db", async () => {
        const { openProjectDatabase } = await import("../storage/database.js");
        const db = openProjectDatabase();
        db.close();

        expect(openedPath.endsWith(path.join(".mygit", "mygit.db"))).toBe(true);
    });

    it("useAgent is wired to project DB factory", () => {
        const sourcePath = path.join(process.cwd(), "tui", "hooks", "useAgent.ts");
        const source = fs.readFileSync(sourcePath, "utf-8");
        expect(source).toContain("openProjectDatabase");
        expect(source).toContain("openProjectDatabase()");
    });
});
