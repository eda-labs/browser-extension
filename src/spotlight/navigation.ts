import type { WorkflowMeta } from './types';

export function navigate(href: string): void {
  try {
    const url = new URL(href, location.origin);
    if (url.origin === location.origin) {
      history.pushState(null, '', url.pathname + url.search + url.hash);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else {
      location.href = href;
    }
  } catch {
    location.href = href;
  }
}

function selectWorkflowType(
  meta: WorkflowMeta,
  humanizeLabel: (text: string) => string,
  attempt: number,
): void {
  if (attempt > 15) return;

  const dialogs = document.querySelectorAll('[role="dialog"], [role="presentation"], [class*="Modal"], [class*="Dialog"]');
  if (dialogs.length === 0) {
    setTimeout(() => selectWorkflowType(meta, humanizeLabel, attempt + 1), 300);
    return;
  }

  const selects = Array.from(document.querySelectorAll('select, [role="listbox"], [role="combobox"], [class*="Select"]'));
  for (const selectElement of selects) {
    if (selectElement instanceof HTMLSelectElement) {
      for (const option of Array.from(selectElement.options)) {
        if (option.text.toLowerCase().includes(meta.kind.toLowerCase()) || option.value.toLowerCase().includes(meta.plural.toLowerCase())) {
          selectElement.value = option.value;
          selectElement.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }
  }

  const muiSelects = Array.from(document.querySelectorAll('[class*="MuiSelect"], [class*="select"], [role="button"][aria-haspopup]'));
  for (const muiSelect of muiSelects) {
    if (muiSelect instanceof HTMLElement) {
      muiSelect.click();
      setTimeout(() => {
        const menuItems = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], [class*="MenuItem"], li[class*="MuiMenuItem"]'));
        for (const item of menuItems) {
          const text = item.textContent?.trim().toLowerCase() ?? '';
          if (text.includes(meta.kind.toLowerCase()) || text.includes(humanizeLabel(meta.kind).toLowerCase())) {
            (item as HTMLElement).click();
            return;
          }
        }
      }, 300);
      return;
    }
  }

  setTimeout(() => selectWorkflowType(meta, humanizeLabel, attempt + 1), 300);
}

export function triggerWorkflowRun(
  meta: WorkflowMeta,
  humanizeLabel: (text: string) => string,
): void {
  navigate('/ui/main/workflows');

  const maxAttempts = 20;
  let attempt = 0;

  function tryClick(): void {
    attempt += 1;
    const buttons = Array.from(document.querySelectorAll('button'));
    let newRunButton: HTMLElement | null = null;
    for (const button of buttons) {
      const text = button.textContent?.trim().toLowerCase() ?? '';
      if (text.includes('new workflow run') || text.includes('new run') || text.includes('create workflow')) {
        newRunButton = button;
        break;
      }
    }

    if (!newRunButton) {
      const fabs = Array.from(document.querySelectorAll('[class*="Fab"], [class*="fab"], [aria-label*="new"], [aria-label*="create"], [aria-label*="add"]'));
      for (const fab of fabs) {
        if (fab instanceof HTMLElement) {
          newRunButton = fab;
          break;
        }
      }
    }

    if (!newRunButton) {
      if (attempt < maxAttempts) {
        setTimeout(tryClick, 300);
      }
      return;
    }

    newRunButton.click();
    setTimeout(() => selectWorkflowType(meta, humanizeLabel, 0), 300);
  }

  setTimeout(tryClick, 500);
}
