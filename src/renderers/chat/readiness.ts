export type ChatReadyReceipt = {
  revision: number;
  ready: true;
  width: number;
  height: number;
  fontsReady: true;
  assetsDecoded: true;
};

const nextFrame = () => new Promise<void>((resolve) => {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  requestAnimationFrame(() => finish());
  setTimeout(finish, 50);
});

/**
 * Settle contract for the chat renderers: the requested revision is still current, fonts are
 * loaded, every image has decoded, and two frames have painted. Motion is time-derived, so there
 * are no animations to wait out.
 */
export async function waitForChatReady(root: HTMLElement, requested: number, current: () => number): Promise<ChatReadyReceipt> {
  const failIfStale = () => {
    const live = current();
    if (requested !== live) throw new Error(`stale revision ${requested}; current is ${live}`);
  };
  failIfStale();
  if (document.fonts?.ready) await document.fonts.ready;
  const deadline = performance.now() + 2500;
  while (performance.now() < deadline) {
    failIfStale();
    const pending = [...root.querySelectorAll("img")].filter((img) => img.isConnected && (!img.complete || img.naturalWidth === 0));
    if (pending.length === 0) break;
    await Promise.race([
      Promise.all(pending.map((img) => img.decode().catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 50)),
    ]);
  }
  const stuck = [...root.querySelectorAll("img")].filter((img) => img.isConnected && (!img.complete || img.naturalWidth === 0));
  if (stuck.length > 0) throw new Error(`asset decode failed: ${stuck[0]?.currentSrc || stuck[0]?.getAttribute("src") || "image"}`);
  await nextFrame();
  await nextFrame();
  failIfStale();
  const box = root.getBoundingClientRect();
  return { revision: requested, ready: true, width: box.width, height: box.height, fontsReady: true, assetsDecoded: true };
}
