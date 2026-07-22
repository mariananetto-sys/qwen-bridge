import React from 'react';
import { Box, Text } from 'ink';

/**
 * Chat Component
 * Displays conversation messages with color coding by role
 */
export default function Chat({ messages }) {
  const getColor = (role) => {
    switch (role) {
      case 'user':
        return 'cyan';
      case 'assistant':
        return 'green';
      case 'system':
        return 'gray';
      default:
        return 'white';
    }
  };

  const getPrefix = (role) => {
    switch (role) {
      case 'user':
        return '👤';
      case 'assistant':
        return '🤖';
      case 'system':
        return '⚙️ ';
      default:
        return '•';
    }
  };

  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      {messages && messages.length === 0 ? (
        <Box
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          paddingY={1}
        >
          <Text dim>
            No messages yet. Start typing to begin chat...
          </Text>
        </Box>
      ) : (
        messages.map((msg, idx) => (
          <Box key={idx} flexDirection="column" marginBottom={0.5}>
            <Box>
              <Text 
                color={getColor(msg.role)}
                bold
              >
                {getPrefix(msg.role)} {msg.role}:
              </Text>
            </Box>
            <Box paddingX={2}>
              <Text wrap="wrap">{msg.content}</Text>
            </Box>
          </Box>
        ))
      )}
    </Box>
  );
}
