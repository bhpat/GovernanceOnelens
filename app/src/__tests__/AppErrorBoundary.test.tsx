import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { describe, expect, it, vi } from 'vitest';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';

function BrokenPage(): never {
  throw new Error('Required deployment configuration is missing.');
}

describe('AppErrorBoundary', () => {
  it('renders a recovery surface for child render failures', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <FluentProvider theme={webLightTheme}>
        <AppErrorBoundary>
          <BrokenPage />
        </AppErrorBoundary>
      </FluentProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Governance OneLens could not load' })).toBeInTheDocument();
    expect(screen.getByText('Required deployment configuration is missing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload application' })).toBeInTheDocument();
    consoleError.mockRestore();
  });
});