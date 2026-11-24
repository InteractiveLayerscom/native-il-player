// The product panels of the SDK name the family 'IL Montserrat'. Its file sits in fonts/ next to this bundle on the CDN,
// and is declared here, once per document, so the built CSS stays small and nothing is downloaded for a player that
// never shows a product. Adding a FontFace does not fetch it: the browser asks for the file only when text drawn with
// the family appears, and a failed request leaves the panel in the next font of its list.
const declared = new WeakSet();

export function declareFont(doc, view = doc.defaultView) {
  if (!view || declared.has(doc)) return;
  declared.add(doc);
  try {
    // Only browsers with variable fonts and the FontFace API: the others keep the fallback fonts.
    if (typeof view.FontFace !== 'function' || !doc.fonts || !view.CSS?.supports?.('font-variation-settings', 'normal')) return;
    // The file is found from this module's own address, wherever it was loaded from (a script tag, an import, a CDN).
    // A bundle with no http(s) address of its own (a blob, a data URL) has no folder to look in, so it declares nothing.
    const file = 'fonts/Montserrat-wght.woff2';
    const url = new URL(file, import.meta.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    doc.fonts.add(new view.FontFace('IL Montserrat', `url("${url.href}") format("woff2")`, { weight: '100 900', style: 'normal', display: 'swap' }));
  } catch {
    // A page that forbids it simply keeps the fallback fonts.
  }
}
