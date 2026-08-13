import { Box, Menu } from '@mantine/core';
import { ReactNode } from 'react';

export function ContextMenu(props: {
  opened: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <Menu
      opened={props.opened}
      onChange={(opened) => {
        if (!opened) props.onClose();
      }}
      position='bottom-start'
      offset={4}
      shadow='md'
      width={props.width ?? 160}
      zIndex={1000}
      withinPortal
    >
      <Menu.Target>
        <Box
          style={{
            position: 'fixed',
            top: props.y,
            left: props.x,
            width: 0,
            height: 0,
          }}
        />
      </Menu.Target>
      <Menu.Dropdown>{props.children}</Menu.Dropdown>
    </Menu>
  );
}
