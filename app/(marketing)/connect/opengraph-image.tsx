import { OG_SIZE, pageImage } from "@/lib/og/images";

export const alt = "Connect Threads · Threaded";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return pageImage({
    title: "Connect Threads",
    subtitle: "See exactly what Threaded reads. It only posts when you press Post or schedule.",
  });
}
