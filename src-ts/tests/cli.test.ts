import { describe, it, expect, vi } from "vitest";
import { Command } from "commander";
import { gitCommand } from "../cli/git";
import { agentCommand } from "../cli/agent";

vi.mock("bun:sqlite", () => {
    class FakeDatabase {
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

describe("CLI Commands", () => {
    describe("gitCommand", () => {
        it("should create a git command", () => {
            const cmd = gitCommand();
            expect(cmd.name()).toBe("git");
            expect(cmd.description()).toContain("Git command wrapper");
        });
    });

    describe("agentCommand", () => {
        it("should create an agent command", () => {
            const cmd = agentCommand();
            expect(cmd.name()).toBe("agent");
            expect(cmd.description()).toContain("Run the agent");
        });
    });
});
