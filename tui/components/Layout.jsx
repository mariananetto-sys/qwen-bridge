import React from 'react';
import { Box, Text } from 'ink';

/**
 * Layout Component
 * Provides the main UI structure with header, content, and footer areas
 */
export default function Layout({ children, title }) {
  return (
    <Box flexDirection="column" width={100} height={30}>
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        paddingY={0}
        marginBottom={1}
      >
        <Text bold cyan>
          🤖 {title || 'QWEN TUI'} 
        </Text>
      </Box>

      {/* Main Content */}
      <Box flexDirection="column" flexGrow={1} marginBottom={1}>
        {children}
      </Box>

      {/* Footer */}
      <Box borderStyle="round" borderColor="gray">
        <Text dim>
          Ctrl+C to exit • Tab to switch mode
        </Text>
      </Box>
    </Box>
  );
}
