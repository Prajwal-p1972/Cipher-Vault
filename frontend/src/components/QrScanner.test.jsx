import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QrScanner } from './QrScanner.jsx';

describe('QrScanner Component Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows friendly error message when getUserMedia permission is denied', async () => {
    const permissionError = new Error('Permission denied');
    permissionError.name = 'NotAllowedError';

    const getUserMediaMock = vi.fn().mockRejectedValue(permissionError);
    Object.assign(navigator, {
      mediaDevices: {
        getUserMedia: getUserMediaMock
      }
    });

    render(<QrScanner onResult={vi.fn()} onCancel={vi.fn()} />);

    expect(
      await screen.findByText(/Camera permission denied. Please allow camera access/i)
    ).toBeTruthy();
  });

  it('stops all media stream tracks on unmount', async () => {
    const stopMock1 = vi.fn();
    const stopMock2 = vi.fn();

    const fakeStream = {
      getTracks: () => [
        { stop: stopMock1 },
        { stop: stopMock2 }
      ]
    };

    const getUserMediaMock = vi.fn().mockResolvedValue(fakeStream);
    Object.assign(navigator, {
      mediaDevices: {
        getUserMedia: getUserMediaMock
      }
    });

    const { unmount } = render(<QrScanner onResult={vi.fn()} onCancel={vi.fn()} />);

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalled();
    });

    // Unmount scanner component
    unmount();

    expect(stopMock1).toHaveBeenCalledTimes(1);
    expect(stopMock2).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel button is clicked and stops tracks', async () => {
    const stopMock = vi.fn();
    const fakeStream = {
      getTracks: () => [{ stop: stopMock }]
    };

    const getUserMediaMock = vi.fn().mockResolvedValue(fakeStream);
    Object.assign(navigator, {
      mediaDevices: {
        getUserMedia: getUserMediaMock
      }
    });

    const onCancelMock = vi.fn();
    render(<QrScanner onResult={vi.fn()} onCancel={onCancelMock} />);

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalled();
    });

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(onCancelMock).toHaveBeenCalledTimes(1);
    expect(stopMock).toHaveBeenCalled();
  });

  it('switches to Upload tab and allows uploading a file', async () => {
    const getUserMediaMock = vi.fn().mockResolvedValue({ getTracks: () => [] });
    Object.assign(navigator, {
      mediaDevices: {
        getUserMedia: getUserMediaMock
      }
    });

    render(<QrScanner onResult={vi.fn()} onCancel={vi.fn()} />);

    const uploadTabBtn = screen.getByRole('tab', { name: /Upload QR Image/i });
    fireEvent.click(uploadTabBtn);

    expect(screen.getByText(/Choose a QR Code Image/i)).toBeTruthy();
  });
});
