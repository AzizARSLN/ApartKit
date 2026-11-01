/**
 * Print an HTML document without relying on window.open popups.
 * Uses a hidden iframe first; falls back to blob tab / HTML download.
 */
export function printHtmlDocument(html: string, fileBaseName = "rapor"): void {
  const printable = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Yazdır");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    iframe.remove();
    openBlobFallback(printable, fileBaseName);
    return;
  }

  doc.open();
  doc.write(printable);
  doc.close();

  const cleanup = () => {
    if (iframe.parentNode) iframe.remove();
  };

  const triggerPrint = () => {
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
      openBlobFallback(printable, fileBaseName);
      return;
    }
    win.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(cleanup, 60_000);
  };

  window.setTimeout(triggerPrint, 250);
}

function openBlobFallback(html: string, fileBaseName: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  // Do not pass "noopener" — many browsers then return null from window.open.
  const w = window.open(url, "_blank");
  if (w) {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileBaseName}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  alert("Yazdırma penceresi açılamadı. Rapor HTML olarak indirildi; tarayıcıda açıp yazdırabilirsiniz.");
}
