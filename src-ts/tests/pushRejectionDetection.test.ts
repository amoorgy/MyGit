/**
 * Tests for push rejection and merge conflict detection in the executor.
 */

import { describe, it, expect } from "vitest";
import { isPushRejected, hasMergeConflictMarkers } from "../executor/index.js";

describe("isPushRejected", () => {
    it("detects non-fast-forward rejection", () => {
        expect(isPushRejected(
            "! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs"
        )).toBe(true);
    });

    it("detects fetch first message", () => {
        expect(isPushRejected(
            "error: failed to push some refs to 'origin'\nhint: Updates were rejected because the remote contains work that you do not have locally.\nhint: fetch first"
        )).toBe(true);
    });

    it("detects updates were rejected", () => {
        expect(isPushRejected(
            "hint: Updates were rejected because the tip of your current branch is behind"
        )).toBe(true);
    });

    it("detects remote rejected", () => {
        expect(isPushRejected(
            "! [remote rejected] main -> main (pre-receive hook declined)"
        )).toBe(true);
    });

    it("detects failed to push some refs", () => {
        expect(isPushRejected(
            "error: failed to push some refs to 'git@github.com:user/repo.git'"
        )).toBe(true);
    });

    it("returns false for unrelated errors", () => {
        expect(isPushRejected("fatal: Authentication failed")).toBe(false);
    });

    it("returns false for empty string", () => {
        expect(isPushRejected("")).toBe(false);
    });

    it("returns false for permission denied", () => {
        expect(isPushRejected("fatal: Permission denied (publickey)")).toBe(false);
    });
});

describe("hasMergeConflictMarkers", () => {
    it("detects automatic merge failed", () => {
        expect(hasMergeConflictMarkers(
            "Auto-merging src/index.ts\nCONFLICT (content): Merge conflict in src/index.ts\nAutomatic merge failed; fix conflicts and then commit the result."
        )).toBe(true);
    });

    it("detects fix conflicts message", () => {
        expect(hasMergeConflictMarkers(
            "error: fix conflicts and then commit the result"
        )).toBe(true);
    });

    it("detects merge conflict in file", () => {
        expect(hasMergeConflictMarkers(
            "CONFLICT (content): Merge conflict in README.md"
        )).toBe(true);
    });

    it("detects conflict (content) marker", () => {
        expect(hasMergeConflictMarkers(
            "CONFLICT (content): blah"
        )).toBe(true);
    });

    it("returns false for clean merge", () => {
        expect(hasMergeConflictMarkers(
            "Auto-merging src/index.ts\nMerge made by the 'ort' strategy."
        )).toBe(false);
    });

    it("returns false for empty string", () => {
        expect(hasMergeConflictMarkers("")).toBe(false);
    });
});
