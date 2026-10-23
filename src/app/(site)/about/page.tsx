import { ContentPage, contentPageMetadata } from "../content-page";

export const metadata = contentPageMetadata("about", "About The Leftovers, a 90s & 2000s rock cover band from Lincoln, Nebraska.");

export default function AboutPage() {
  return <ContentPage slug="about" />;
}
