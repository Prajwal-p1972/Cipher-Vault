import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationBell, addNotificationToList } from './NotificationBell.jsx';

describe('NotificationBell Component Tests', () => {
  it('renders unread count badge correctly and hides when count is 0', () => {
    const { rerender } = render(
      <NotificationBell
        unreadCount={3}
        notifications={[
          { id: '1', senderName: 'Alice', originalName: 'doc1.pdf', read: false },
          { id: '2', senderName: 'Bob', originalName: 'doc2.pdf', read: false },
          { id: '3', senderName: 'Charlie', originalName: 'doc3.pdf', read: false }
        ]}
      />
    );

    const badge = screen.getByTestId('unread-badge');
    expect(badge.textContent).toBe('3');

    // Rerender with 0 unread
    rerender(<NotificationBell unreadCount={0} notifications={[]} />);
    expect(screen.queryByTestId('unread-badge')).toBeNull();
  });

  it('triggers mark-as-read action and clears the unread count', () => {
    function ControlledParent() {
      const [unread, setUnread] = useState(2);
      const [items, setItems] = useState([
        { id: '1', senderName: 'Alice', originalName: 'doc1.pdf', read: false },
        { id: '2', senderName: 'Bob', originalName: 'doc2.pdf', read: false }
      ]);

      return (
        <NotificationBell
          unreadCount={unread}
          notifications={items}
          onMarkAllAsRead={() => {
            setUnread(0);
            setItems((prev) => prev.map((x) => ({ ...x, read: true })));
          }}
        />
      );
    }

    render(<ControlledParent />);

    expect(screen.getByTestId('unread-badge').textContent).toBe('2');

    // Click bell icon to open dropdown
    const bellBtn = screen.getByRole('button', { name: /Notifications/i });
    fireEvent.click(bellBtn);

    // Click "Mark all as read"
    const markReadBtn = screen.getByRole('button', { name: /Mark all as read/i });
    fireEvent.click(markReadBtn);

    expect(screen.queryByTestId('unread-badge')).toBeNull();
  });

  it('enforces a strict cap of 20 notifications (pure helper & component)', () => {
    // 1. Verify addNotificationToList helper caps at 20
    let list = [];
    for (let i = 1; i <= 25; i++) {
      list = addNotificationToList(list, {
        id: `id-${i}`,
        senderName: `User ${i}`,
        originalName: `file-${i}.pdf`,
        read: false
      });
    }

    expect(list.length).toBe(20);
    // Newest item is at the head
    expect(list[0].id).toBe('id-25');
    // Oldest kept item
    expect(list[19].id).toBe('id-6');

    // 2. Verify component slice behavior with 25 passed items
    const manyItems = Array.from({ length: 25 }, (_, i) => ({
      id: `doc-${i}`,
      senderName: `User ${i}`,
      originalName: `doc-${i}.pdf`,
      read: false
    }));

    render(<NotificationBell unreadCount={25} notifications={manyItems} />);

    const bellBtn = screen.getByRole('button', { name: /Notifications/i });
    fireEvent.click(bellBtn);

    const notificationElements = screen.getAllByRole('listitem');
    expect(notificationElements.length).toBe(20);
  });
});
