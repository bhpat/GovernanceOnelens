import { useCallback } from 'react';
import { Toast, ToastBody, ToastTitle, useToastController, type ToastIntent } from '@fluentui/react-components';

/**
 * Shared toaster id — a single `<Toaster toasterId={APP_TOASTER_ID} />` is
 * mounted once in `Shell.tsx`; every page/component dispatches into it via
 * {@link useAppToast} instead of mounting its own `<Toaster>`. Fluent's toast
 * system is id-based rather than context-based, so this constant is what lets
 * a toast dispatched from deep inside e.g. an asset profile actually render.
 */
export const APP_TOASTER_ID = 'onelens-app-toaster';

/** Dispatch a lightweight, auto-dismissing toast from anywhere in the app. */
export function useAppToast() {
  const { dispatchToast } = useToastController(APP_TOASTER_ID);

  return useCallback(
    (title: string, options?: { body?: string; intent?: ToastIntent }) => {
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
          {options?.body && <ToastBody>{options.body}</ToastBody>}
        </Toast>,
        { intent: options?.intent ?? 'success', timeout: 3000 }
      );
    },
    [dispatchToast]
  );
}
