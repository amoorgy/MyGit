import { Command } from "commander";
import * as path from "path";
import * as fs from "fs/promises";
import { writeFileSync, chmodSync } from "fs";
import * as os from "os";

export function installCommand(): Command {
    const install = new Command("install")
        .description("Install mygit globally via symlink")
        .option("--prefix <dir>", "Installation directory", path.join(os.homedir(), ".local", "bin"))
        .action(async (opts: { prefix: string }) => {
            try {
                const binDir = opts.prefix;
                const linkPath = path.join(binDir, "mygit");

                // Ensure bin directory exists
                await fs.mkdir(binDir, { recursive: true });

                // Find the entry point
                // import.meta.dir points to src-ts/cli, so we need to go up one level to get to src-ts
                const cliDir = import.meta.dir ?? path.join(process.cwd(), "cli");
                const srcTsDir = path.resolve(cliDir, "..");
                const entryPoint = path.join(srcTsDir, "index.tsx");

                // Create a wrapper script
                const wrapper = `#!/usr/bin/env bash
exec bun run "${entryPoint}" "$@"
`;

                // Use synchronous write for better compatibility
                // Remove existing file/symlink if it exists
                try {
                    await fs.unlink(linkPath);
                } catch (err: any) {
                    // Ignore if file doesn't exist
                    if (err.code !== "ENOENT") throw err;
                }

                writeFileSync(linkPath, wrapper, { mode: 0o755 });
                console.log(`Installed mygit to ${linkPath}`);

                // Check if bin dir is in PATH
                const pathDirs = (process.env.PATH ?? "").split(":");
                if (!pathDirs.includes(binDir)) {
                    console.log(`\nNote: ${binDir} is not in your PATH.`);
                    console.log(`Add this to your shell profile:`);
                    console.log(`  export PATH="${binDir}:$PATH"`);
                }
            } catch (err: any) {
                console.error(`Install failed: ${err.message}`);
                process.exit(1);
            }
        });

    return install;
}
