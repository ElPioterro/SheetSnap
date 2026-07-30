import fs from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * A4 PDF assembly — port of the original fpdf logic:
 * portrait A4, 10mm side margins, 30mm top margin, 5mm gap between lines,
 * title centered on the first page, images flow across pages.
 */

const MM = 72 / 25.4; // mm → PDF points

const PAGE_W = 210 * MM;
const PAGE_H = 297 * MM;
const SIDE = 10 * MM;
const TOP = 30 * MM;
const GAP = 5 * MM;

export interface PdfImageInput {
  absPath: string;
  width: number;
  height: number;
}

export async function buildPdf(
  images: PdfImageInput[],
  title: string,
  outPath: string,
): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (title || "Extracted sheet music").slice(0, 140);
  doc.setTitle(text);

  const availW = PAGE_W - 2 * SIDE;
  let page = doc.addPage([PAGE_W, PAGE_H]);

  // Title centered on the first page (matches original cell at y=15mm)
  const tw = font.widthOfTextAtSize(text, 16);
  page.drawText(text, {
    x: Math.max(SIDE, (PAGE_W - tw) / 2),
    y: PAGE_H - 22 * MM,
    size: 16,
    font,
    color: rgb(0, 0, 0),
  });

  let yTop = TOP;
  for (const img of images) {
    const bytes = fs.readFileSync(img.absPath);
    const png = await doc.embedPng(bytes);
    const dispH = availW * (img.height / img.width);
    if (yTop + dispH > PAGE_H - SIDE) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      yTop = TOP;
    }
    page.drawImage(png, {
      x: SIDE,
      y: PAGE_H - yTop - dispH,
      width: availW,
      height: dispH,
    });
    yTop += dispH + GAP;
  }

  fs.writeFileSync(outPath, await doc.save());
}
