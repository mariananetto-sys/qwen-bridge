import React from 'react';
import { Box, Text } from 'ink';

/**
 * Input Component
 * Captures user input with visual feedback
 */
export default function Input({ value, onChange, isLoading }) {
  return (
    <Box
      borderStyle="round"
      borderColor={isLoading ? 'yellow' : 'cyan'}
      paddingX={1}
      paddingY={0}
    >
      <Box marginRight={1}>
        <Text 
          bold 
          color={isLoading ? 'yellow' : 'cyan'}
        >
          {isLoading ? '⏳' : '> '}
        </Text>
      </Box>
      <Text>{value}</Text>
      {!isLoading && (
        <Text color="gray" dimColor>
          {' | '}
        </Text>
      )}
    </Box>
  );
}
