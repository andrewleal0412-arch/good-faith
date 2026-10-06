import "server-only";
import { cache } from "react";
import { packOf } from "./next-step";
import { kindFromSlug, recordFor } from "./notices";
import { loadUnit } from "./units";

/** The tenancy's summary, the notice or record the address names and its entry in the state's pack, read once per
 *  request: the landlord layout asks first, so an address that names nothing this tenancy's state has answers 404
 *  before anything streams (answersNotFound), and the page fills the draft from it. Null for such an address. The
 *  caller has checked the tenancy is in the session's workspace (ownedTenancy, pageTenancy). */
export const noticeOf = cache(async (id: string, slug: string) => {
  const t = await loadUnit(id);
  if (!t) return null;
  const pack = packOf(t);
  const kind = kindFromSlug(slug, pack);
  const info = kind ? recordFor(pack, kind) : null;
  return kind && info ? { t, pack, kind, info } : null;
});
