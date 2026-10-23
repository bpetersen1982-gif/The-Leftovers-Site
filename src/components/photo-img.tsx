import type { PhotoImage } from "@/lib/photos/queries";

/**
 * Responsive photo from pre-generated WebP sizes. A plain <img> on purpose: the files are
 * already resized at upload, so next/image would only re-process them on our server.
 * Width/height prevent layout shift; the blur placeholder shows until the image paints.
 */
export function PhotoImg({
  image,
  alt,
  sizes,
  className = "",
  priority = false,
}: {
  image: PhotoImage;
  alt: string;
  /** e.g. "(min-width: 768px) 33vw, 50vw" */
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  const srcSet = image.sources.map((source) => `${source.url} ${source.width}w`).join(", ");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- variants are pre-sized at upload; see above
    <img
      src={image.src}
      srcSet={srcSet}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={className}
      style={image.blurDataUrl ? { backgroundImage: `url("${image.blurDataUrl}")`, backgroundSize: "cover" } : undefined}
    />
  );
}
