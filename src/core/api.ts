// Minimal type declarations for the browser extension APIs we use.

export interface BrowserAPI {
  runtime: {
    sendMessage: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
    onMessage: {
      addListener: (
        callback: (
          message: Record<string, unknown>,
          sender: unknown,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sendResponse: (response: any) => void,
        ) => boolean | void,
      ) => void;
    };
  };
  alarms: {
    create: (name: string, info: { periodInMinutes?: number; delayInMinutes?: number }) => void;
    clear: (name: string) => void;
    onAlarm: {
      addListener: (callback: (alarm: { name: string }) => void) => void;
    };
  };
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (keys: string[]) => Promise<void>;
    };
    onChanged: {
      addListener: (
        callback: (
          changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
          areaName: string,
        ) => void,
      ) => void;
      removeListener: (
        callback: (
          changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
          areaName: string,
        ) => void,
      ) => void;
    };
  };
}

declare const browser: BrowserAPI | undefined;
declare const chrome: BrowserAPI;

export const api: BrowserAPI = typeof browser !== 'undefined' ? browser : chrome;
