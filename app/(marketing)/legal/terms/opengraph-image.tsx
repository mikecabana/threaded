import { OG_SIZE, pageImage } from "@/lib/og/images";

export const alt = "Terms of Service · Threaded";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return pageImage({
    title: "Terms of Service",
    subtitle: "Your account and content, credits and payment, and acceptable use.",
  });
}
