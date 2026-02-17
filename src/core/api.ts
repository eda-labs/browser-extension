// Minimal type declarations for the browser extension APIs we use.

export interface BrowserAPI {
  runtime: {
    sendMessage: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
    onMessage: {
      addListener: (
        callback: (
          message: Record<string, unknown>,
          sender: {
            tab?: {
              id?: number;
              url?: string;
            };
            url?: string;
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sendResponse: (response: any) => void,
        ) => boolean | void,
      ) => void;
    };
  };
  tabs: {
    sendMessage: (tabId: number, message: Record<string, unknown>) => Promise<Record<string, unknown>>;
    create: (
      createProperties: { url: string; active?: boolean },
    ) => Promise<{ id?: number } | undefined>;
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
