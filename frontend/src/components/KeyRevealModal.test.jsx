import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KeyRevealModal } from './KeyRevealModal.jsx';

describe('KeyRevealModal Component Tests', () => {
  const SECRET_KEY = '5a1b3c9d7e8f00112233445566778899aabbccddeeff00112233445566778899';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the secret key once with copy capability and security warning', async () => {
    let copiedText = '';
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async (text) => {
          copiedText = text;
        })
      }
    });

    const onClose = vi.fn();
    render(
      <KeyRevealModal
        documentKey={SECRET_KEY}
        documentName="confidential.pdf"
        onClose={onClose}
      />
    );

    // Key is visible in DOM
    const keyElement = screen.getByTestId('document-key-value');
    expect(keyElement.textContent).toBe(SECRET_KEY);

    // Warning is clearly displayed
    expect(screen.getByText(/Shown only once/i)).toBeTruthy();

    // Copy action
    const copyBtn = screen.getByRole('button', { name: /Copy Key/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SECRET_KEY);
    expect(copiedText).toBe(SECRET_KEY);
    expect(await screen.findByText('Copied!')).toBeTruthy();
  });

  it('enforces "I saved it" confirmation before allowing close, then wipes key', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log');
    const consoleWarnSpy = vi.spyOn(console, 'warn');
    const consoleErrorSpy = vi.spyOn(console, 'error');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    function ModalWrapper() {
      const [isOpen, setIsOpen] = useState(true);
      return isOpen ? (
        <KeyRevealModal
          documentKey={SECRET_KEY}
          documentName="report.zip"
          onClose={() => setIsOpen(false)}
        />
      ) : (
        <div data-testid="closed-state">Modal Closed</div>
      );
    }

    render(<ModalWrapper />);

    // Verify key exists
    expect(screen.getByText(SECRET_KEY)).toBeTruthy();

    const closeBtn = screen.getByRole('button', { name: /Close & Clear Key/i });
    const confirmCheckbox = screen.getByLabelText(/I saved it/i);

    // Attempt close without confirmation -> disabled
    expect(closeBtn.hasAttribute('disabled')).toBe(true);
    fireEvent.click(closeBtn);
    expect(screen.getByText(SECRET_KEY)).toBeTruthy();

    // Check "I saved it" -> enabled
    fireEvent.click(confirmCheckbox);
    expect(closeBtn.hasAttribute('disabled')).toBe(false);

    // Execute close
    fireEvent.click(closeBtn);

    // Confirm closed state
    expect(screen.getByTestId('closed-state')).toBeTruthy();
    expect(screen.queryByText(SECRET_KEY)).toBeNull();

    // Verify security constraints: zero persistence in storage and zero console leaks
    expect(setItemSpy).not.toHaveBeenCalled();
    for (const spy of [consoleLogSpy, consoleWarnSpy, consoleErrorSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(SECRET_KEY);
        }
      }
    }
  });
});
