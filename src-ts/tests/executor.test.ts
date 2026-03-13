import { describe, it, expect } from "vitest";
import {
    isLikelyExternalFetchShellCommand,
    normalizeShellFailure,
} from "../executor/index.js";

describe("executor shell fallback helpers", () => {
    it("detects curl and url-based external fetch attempts", () => {
        expect(isLikelyExternalFetchShellCommand("curl https://example.com")).toBe(true);
        expect(isLikelyExternalFetchShellCommand("wget http://example.com/file")).toBe(true);
        expect(isLikelyExternalFetchShellCommand("printf 'https://example.com'")).toBe(true);
        expect(isLikelyExternalFetchShellCommand("ls -la src")).toBe(false);
    });

    it("normalizes offline-like fetch failures", () => {
        const result = normalizeShellFailure(
            "curl https://example.com",
            "curl: (6) Could not resolve host: example.com",
        );
        expect(result.success).toBe(false);
        expect(result.kind).toBe("offline");
        expect(result.error).toContain("Continue with local repo inspection");
    });

    it("normalizes page-unavailable fetch failures", () => {
        const result = normalizeShellFailure(
            "wget https://example.com/missing",
            "HTTP request sent, awaiting response... 404 Not Found",
        );
        expect(result.success).toBe(false);
        expect(result.kind).toBe("network_fail");
        expect(result.error).toContain("page unavailable");
    });

    it("keeps non-network command failures generic", () => {
        const result = normalizeShellFailure("cat missing.txt", "No such file or directory");
        expect(result.success).toBe(false);
        expect(result.kind).toBe("command_fail");
        expect(result.error).toBe("No such file or directory");
    });
});

