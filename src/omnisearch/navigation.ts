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
