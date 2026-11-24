import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

/**
 * Link-preview cards (requirements SEO-2): the 1200×630 image Facebook, iMessage, Slack,
 * X, etc. show when someone shares a page. Rendered on the server from brand colors, the
 * Oswald heading font (assets/fonts, SIL OFL), and the wordmark logo.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const COLORS = { ink: "#0B0B0B", charcoal: "#252525", cream: "#D8CFBD", red: "#B52B2B" } as const;

let assets: Promise<{ logo: string; regular: Buffer; bold: Buffer }> | undefined;

function loadAssets() {
  assets ??= (async () => {
    const root = process.cwd();
    const [logo, regular, bold] = await Promise.all([
      readFile(path.join(root, "public", "brand", "logo-wordmark.png")),
      readFile(path.join(root, "assets", "fonts", "Oswald-400.ttf")),
      readFile(path.join(root, "assets", "fonts", "Oswald-700.ttf")),
    ]);
    return { logo: `data:image/png;base64,${logo.toString("base64")}`, regular, bold };
  })();
  return assets;
}

/** Keeps titles inside the card: long venue names get a smaller font, then an ellipsis. */
function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export async function ogCard(input: { eyebrow?: string; title: string; subtitle?: string; badge?: string }): Promise<ImageResponse> {
  const { logo, regular, bold } = await loadAssets();
  const title = fit(input.title, 60);
  const titleSize = title.length > 34 ? 64 : title.length > 22 ? 80 : 96;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: COLORS.ink, color: COLORS.cream, padding: "56px 72px", fontFamily: "Oswald" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered by satori, not the browser */}
          <img src={logo} width={378} height={199} alt="" />
          {input.badge && (
            <div style={{ display: "flex", background: COLORS.red, color: COLORS.cream, fontSize: 34, fontWeight: 700, letterSpacing: 3, padding: "10px 24px", textTransform: "uppercase" }}>
              {input.badge}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {input.eyebrow && <div style={{ display: "flex", fontSize: 36, letterSpacing: 4, textTransform: "uppercase", opacity: 0.85 }}>{fit(input.eyebrow, 60)}</div>}
          <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.05, textTransform: "uppercase", marginTop: 8 }}>{title}</div>
          {input.subtitle && <div style={{ display: "flex", fontSize: 36, marginTop: 16, opacity: 0.9 }}>{fit(input.subtitle, 80)}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `6px solid ${COLORS.red}`, paddingTop: 20, fontSize: 30, letterSpacing: 3, textTransform: "uppercase" }}>
          <span>90s &amp; 2000s rock covers · Lincoln, NE</span>
          <span>theleftoversband.com</span>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Oswald", data: regular, weight: 400, style: "normal" },
        { name: "Oswald", data: bold, weight: 700, style: "normal" },
      ],
      headers: { "Cache-Control": "public, max-age=3600" },
    },
  );
}
