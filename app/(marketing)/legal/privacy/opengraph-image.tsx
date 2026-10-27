import { OG_SIZE, pageImage } from "@/lib/og/images";

export const alt = "Privacy Policy · Threaded";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return pageImage({
    title: "Privacy Policy",
    subtitle: "What we collect from Threads, how we use it, and how to delete it.",
  });
}
