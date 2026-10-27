import { landingImage, OG_SIZE } from "@/lib/og/images";

export const alt =
  "Threaded: grow on Threads with posts that sound like you. A post idea scored for engagement, next to the author's best post.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return landingImage();
}
