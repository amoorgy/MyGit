import React from 'react';
import { render, Text, Box } from 'ink';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

marked.setOptions({ renderer: new TerminalRenderer() as any });

const md = `
# Markdown Test
Here is **bold** and *italic* text.

* list 1
* list 2

\`\`\`ts
const x = 1;
\`\`\`
`;
const text = marked(md) as string;

// Let's print raw string to terminal first to verify markedTerminal output
console.log(text);
