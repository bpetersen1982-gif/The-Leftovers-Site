/** Structured data for search engines (schema.org). "<" is escaped so the data can never close the tag. */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll("<", "\\u003c") }} />;
}
