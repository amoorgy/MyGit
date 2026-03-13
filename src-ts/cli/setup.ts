import React from "react";
import { Command } from "commander";
import { render } from "ink";
import { SetupWizard } from "../tui/setup/SetupWizard.js";
import { initStdinFilter, cleanupStdinFilter } from "../tui/stdinFilter.js";

export function setupCommand(): Command {
    return new Command("setup")
        .description("Interactive setup wizard for mygit configuration")
        .option("--scope <scope>", "Config scope: global or project", "global")
        .action(async (opts: { scope: string }) => {
            const filter = initStdinFilter(process.stdin, process.stdout, false);
            const ink = render(
                React.createElement(SetupWizard, { scope: opts.scope }),
                { stdin: filter as unknown as NodeJS.ReadStream, exitOnCtrlC: true },
            );
            try {
                await ink.waitUntilExit();
            } finally {
                cleanupStdinFilter();
            }
        });
}
