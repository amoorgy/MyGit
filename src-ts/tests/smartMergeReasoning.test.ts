/**
 * Tests for the simplified smart merge response parsing.
 */

import { describe, it, expect } from "vitest";
import { extractJson } from "../merge/smart.js";

describe("extractJson", () => {
    it("extracts direct JSON object", () => {
        const input = '{"strategy_name": "accept theirs", "decision": "accept_theirs"}';
        expect(extractJson(input)).toBe(input);
    });

    it("extracts JSON from markdown fences", () => {
        const json = '{"strategy_name": "hybrid"}';
        const input = `Here is the resolution:\n\`\`\`json\n${json}\n\`\`\``;
        expect(extractJson(input)).toBe(json);
    });

    it("extracts JSON from plain code fences", () => {
        const json = '{"strategy_name": "accept ours"}';
        const input = `\`\`\`\n${json}\n\`\`\``;
        expect(extractJson(input)).toBe(json);
    });

    it("finds JSON object in surrounding text", () => {
        const input = 'I recommend: {"strategy_name": "hybrid"} as the best approach.';
        expect(extractJson(input)).toBe('{"strategy_name": "hybrid"}');
    });

    it("throws on text with no JSON", () => {
        expect(() => extractJson("No JSON here at all")).toThrow("Could not find JSON");
    });

    it("handles JSON array", () => {
        const input = '[{"strategy_name": "a"}]';
        expect(extractJson(input)).toBe(input);
    });
});
