/** Copyright 2026 GetMCPAds. SPDX-License-Identifier: Apache-2.0 */
/** Graph v26 media insights. Keep format selection explicit; never send the
 * removed engagement/video_views/plays combination to every media type.
 * Native reference: https://www.postman.com/meta/instagram/folder/23987686-f659d7d1-d74c-44e4-9192-9b1e8694c511
 */
export function instagramInsightMetrics(media: Record<string, unknown>): string[] {
  const type = media.media_type;
  const product = media.media_product_type;
  if (product === "STORY") return ["views", "reach"];
  const feed = ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"];
  if (product === "REELS" && type === "VIDEO") {
    return [...feed, "ig_reels_video_view_total_time", "ig_reels_avg_watch_time"];
  }
  if (type === "IMAGE" || type === "CAROUSEL_ALBUM") return feed;
  // Legacy feed videos are not Reels. Their interaction/watch-time metrics
  // are not interchangeable. Unknown formats get the smallest useful read.
  return ["reach"];
}
