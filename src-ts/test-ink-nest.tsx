import React from 'react';
import { render, Text, Box } from 'ink';

const Example = () => (
    <Box>
        <Text>
            <Text>Before </Text>
            <Text bold>bold text</Text>
            <Text> after</Text>
        </Text>
    </Box>
);
render(<Example />);
