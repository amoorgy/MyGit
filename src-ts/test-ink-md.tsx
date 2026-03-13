import React from 'react';
import { render } from 'ink';
import Markdown from 'ink-markdown';

const Example = () => <Markdown># Hello **World**!</Markdown>;
render(<Example />);
