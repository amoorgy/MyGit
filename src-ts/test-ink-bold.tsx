import React from 'react';
import { render, Text, Box } from 'ink';

const Example = () => (
    <Box>
        <Text>Before </Text>
        <Text bold>bold text</Text>
        <Text> after</Text>
    </Box>
);
render(<Example />);
