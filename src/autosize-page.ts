const PAGE_TARGET_ORIGIN = window.location.origin === 'null' ? '*' : window.location.origin;
const AUTOSIZE_BRIDGE_CHANNEL = 'eda-autosize-bridge';
const AUTOSIZE_REQUEST_MSG = 'eda-autosize-request';
const AUTOSIZE_RESPONSE_MSG = 'eda-autosize-response';
const AUTOSIZE_REACT_SCAN_LIMIT = 12_000;
const DEFAULT_AUTOSIZE_OPTIONS = { includeHeaders: true, includeOutliers: true, expand: true };

interface BridgeWindow extends Window {
  __edaExtAutosizeBridgeInstalled?: boolean;
}

interface DataGridAutosizeApi {
  autosizeColumns: (options?: unknown) => unknown;
  rootElementRef?: {
    current?: Element | null;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isElementVisible(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getVisibleElements(selectors: string[]): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];

  for (const selector of selectors) {
    const candidates = document.querySelectorAll(selector);
    for (const candidate of Array.from(candidates)) {
      if (!isElementVisible(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
    }
  }

  return out;
}

function resolveDataGridApiFromRoot(rootElement: HTMLElement): DataGridAutosizeApi | null {
  const fiberKey = Object.getOwnPropertyNames(rootElement)
    .find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$'));
  if (!fiberKey) return null;

  const fiberCandidate = (rootElement as unknown as Record<string, unknown>)[fiberKey];
  if (!isRecord(fiberCandidate)) return null;
  const fiberRoot = isRecord(fiberCandidate.current) ? fiberCandidate.current : fiberCandidate;

  const queue: Record<string, unknown>[] = [fiberRoot];
  const seen = new Set<Record<string, unknown>>();
  let scanned = 0;

  const maybeEnqueue = (value: unknown): void => {
    if (!isRecord(value) || seen.has(value)) return;
    queue.push(value);
  };

  while (queue.length > 0 && scanned < AUTOSIZE_REACT_SCAN_LIMIT) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    scanned += 1;

    const propsCandidates = [node.pendingProps, node.memoizedProps];
    for (const propsCandidate of propsCandidates) {
      const props = isRecord(propsCandidate) ? propsCandidate : null;
      const ownerState = props && isRecord(props.ownerState) ? props.ownerState : null;
      const apiRef = ownerState && isRecord(ownerState.apiRef) ? ownerState.apiRef : null;
      const current = apiRef && isRecord(apiRef.current) ? apiRef.current : null;

      if (current && typeof current.autosizeColumns === 'function') {
        const candidateApi = current as unknown as DataGridAutosizeApi;
        const rootRefCurrent = candidateApi.rootElementRef?.current;

        if (
          !rootRefCurrent
          || rootRefCurrent === rootElement
          || (rootRefCurrent instanceof HTMLElement && rootRefCurrent.contains(rootElement))
          || (rootRefCurrent instanceof HTMLElement && rootElement.contains(rootRefCurrent))
        ) {
          return candidateApi;
        }
      }
    }

    maybeEnqueue(node.child);
    maybeEnqueue(node.sibling);
    maybeEnqueue(node.return);
    maybeEnqueue(node.memoizedState);
    maybeEnqueue(node.memoizedProps);
    maybeEnqueue(node.updateQueue);
    maybeEnqueue(node.stateNode);
  }

  return null;
}

async function runAutosizeAllColumns(options: unknown): Promise<boolean> {
  const autosizeOptions = isRecord(options) ? options : DEFAULT_AUTOSIZE_OPTIONS;
  const dataGridRoots = getVisibleElements(['.MuiDataGrid-root']);
  if (dataGridRoots.length === 0) return false;

  let appliedAny = false;
  for (const root of dataGridRoots) {
    const gridApi = resolveDataGridApiFromRoot(root);
    if (!gridApi) continue;

    try {
      const result = gridApi.autosizeColumns(autosizeOptions);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        await (result as PromiseLike<unknown>);
      }
      appliedAny = true;
    } catch {
      // Continue with other data grids on this page.
    }
  }

  return appliedAny;
}

function postResponse(reqId: string, ok: boolean): void {
  window.postMessage({
    type: AUTOSIZE_RESPONSE_MSG,
    channel: AUTOSIZE_BRIDGE_CHANNEL,
    reqId,
    ok,
  }, PAGE_TARGET_ORIGIN);
}

function handleBridgeMessage(event: MessageEvent): void {
  if (event.source !== window) return;
  if (!event.data || typeof event.data !== 'object') return;

  const data = event.data as Record<string, unknown>;
  if (data.channel !== AUTOSIZE_BRIDGE_CHANNEL) return;
  if (data.type !== AUTOSIZE_REQUEST_MSG) return;
  if (typeof data.reqId !== 'string' || data.reqId.length === 0) return;

  const requestId = data.reqId;
  void (async () => {
    try {
      const ok = await runAutosizeAllColumns(data.options);
      postResponse(requestId, ok);
    } catch {
      postResponse(requestId, false);
    }
  })();
}

const w = window as BridgeWindow;
if (!w.__edaExtAutosizeBridgeInstalled) {
  w.__edaExtAutosizeBridgeInstalled = true;
  window.addEventListener('message', handleBridgeMessage);
}
