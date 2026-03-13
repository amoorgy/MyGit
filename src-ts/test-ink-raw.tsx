import React from 'react';
import { render, Text, Box } from 'ink';

const Example = () => (
    <Box>
        <Text>Hello </Text>
        <Text bold>bold</Text>
    </Box>
);
render(<Example />);
