/** Links into the repository's GitHub issue forms (.github/ISSUE_TEMPLATE), pre-filled where we can. */

export const REPO_URL = 'https://github.com/jakethorn/USD-Mtlx-Support-Graph';
export const ISSUE_CHOOSER_URL = `${REPO_URL}/issues/new/choose`;

const SITE_URL = 'https://jakethorn.github.io';

interface CorrectionContext {
  /** Product id. */
  product?: string;
  /** Product display name, used in the issue title. */
  productName?: string;
  /** Capability id. */
  capability?: string;
  /** Capability label, used in the issue title. */
  capabilityLabel?: string;
  /** Site-relative path including the base, e.g. withBase('products/houdini/'). */
  page?: string;
}

/** "Data correction" issue form, pre-filled with the product, capability and page. */
export function correctionUrl(ctx: CorrectionContext): string {
  const params = new URLSearchParams({ template: 'correction.yml' });
  const what = [ctx.productName ?? ctx.product, ctx.capabilityLabel ?? ctx.capability].filter(Boolean).join(' · ');
  if (what) params.set('title', `Correction: ${what}`);
  if (ctx.product) params.set('product', ctx.product);
  if (ctx.capability) params.set('capability', ctx.capability);
  if (ctx.page) params.set('page', `${SITE_URL}${ctx.page}`);
  return `${REPO_URL}/issues/new?${params}`;
}

/** "Track a product or project" issue form. */
export const trackProductUrl = `${REPO_URL}/issues/new?template=track-product.yml`;
