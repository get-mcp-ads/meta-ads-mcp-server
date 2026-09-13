/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(obj) : [];
const str = (...vs: unknown[]): string | undefined => vs.find(v => typeof v === "string" && v.length > 0 && !v.includes("{{")) as string | undefined;
export type MetaMedia = { media_id: string; image_hash?: string; image_url?: string; thumbnail_url?: string; video_id?: string; source?: string };

/** Facebook permalinks are HTML pages, not files consumable by a model or player. */
export function metaImageFileUrl(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string" || !value || value.includes("{{")) continue;
    try {
      const url = new URL(value);
      if (!/^https?:$/.test(url.protocol)) continue;
      if (/(^|\.)(facebook\.com|fb\.com)$/.test(url.hostname)) continue;
      return value;
    } catch { /* Missing/non-URL metadata is not a file. */ }
  }
}

/** Only advertiser-supplied media. A catalog thumbnail is not a creative cover.
 * Keep the complete raw creative separately for reporting/landing-page callers. */
export function metaCreativeMedia(creative: Row): {format: string; media: MetaMedia[]} {
  const story = obj(creative.object_story_spec), feed = obj(creative.asset_feed_spec);
  const link = obj(story.link_data), video = obj(story.video_data), photo = obj(story.photo_data), template = obj(story.template_data);
  const catalog = Boolean(creative.product_set_id || link.product_set_id || template.product_set_id || feed.product_set_id || Object.keys(template).length);
  const media: MetaMedia[] = [];
  const add = (entry: Row, fallback?: Row) => {
    const video_id = str(entry.video_id);
    const image_hash = str(entry.image_hash, entry.hash);
    const image_url = metaImageFileUrl(entry.image_url, entry.picture, entry.url);
    if (!video_id && !image_hash && !image_url) return;
    media.push({media_id: `${video_id ? 'video' : 'image'}:${video_id ?? image_hash ?? image_url}`,video_id,image_hash,image_url,
      thumbnail_url: metaImageFileUrl(entry.thumbnail_url, image_url, fallback?.thumbnail_url),source:str(entry.source)});
  };
  const children = rows(link.child_attachments);
  if (catalog) {
    // Collection cover lives in video_data/link_data or explicit template media.
    // Never substitute creative.thumbnail_url: Meta can choose a catalog product.
    add(video); add(link); add(template);
  } else if (children.length) {
    children.forEach(child => add(child));
  } else {
    add(video,creative); add(photo,creative); add(link,creative);
  }
  if (!catalog) {
    rows(feed.images).forEach(image => add(image));
    rows(feed.videos).forEach(item => add(item));
    if (!media.length) {
      add(creative);
      if (!media.length && metaImageFileUrl(creative.thumbnail_url)) media.push({media_id:String(creative.id ?? 'preview'),thumbnail_url:metaImageFileUrl(creative.thumbnail_url)});
    }
  }
  const unique = [...new Map(media.map(item => [item.media_id,item])).values()];
  return {format: catalog ? (unique.length ? "collection" : "catalog_dpa") : children.length ? "carousel" : unique.length > 1 ? "flexible" : "single", media: unique};
}
