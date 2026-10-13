import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { normalizeDeck, type XmlTools } from '../src/app/viewers/pptx-normalize';

// The renderer's DOMParser, in Node.
const tools = {
  parse: (text: string) => new DOMParser().parseFromString(text, 'application/xml'),
  serialize: (doc: Document) => new XMLSerializer().serializeToString(doc as any),
} as unknown as XmlTools;

async function deckOf(name: string) {
  const bytes = await readFile(`tests/fixtures/viewers/${name}`);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const zip = await JSZip.loadAsync(await normalizeDeck(buffer as ArrayBuffer, tools));
  return { slide: await zip.file('ppt/slides/slide1.xml')!.async('string'), zip };
}

test('A slide placeholder is told the size, anchor, place and insets its layout and master give it', async () => {
  const { slide } = await deckOf('inherited.pptx');
  const [title, subtitle] = slide.split('<p:sp>').slice(1);
  // The master's 28 pt title, not bold, at the layout's place, anchored to the bottom.
  assert.match(title, /<a:rPr[^>]*sz="2800"/);
  assert.match(title, /<a:rPr[^>]*b="0"/);
  assert.match(title, /<a:off x="914400" y="2377440"\/><a:ext cx="10058400" cy="548640"\/>/);
  assert.match(title, /<a:bodyPr[^>]*anchor="b"/);
  // PowerPoint's insets where nothing says otherwise.
  assert.match(title, /<a:bodyPr[^>]*lIns="91440"/);
  assert.match(title, /<a:bodyPr[^>]*tIns="45720"/);
  // The subtitle takes the layout's centred alignment, and no theme font reference is left.
  assert.match(subtitle, /<a:pPr[^>]*algn="ctr"/);
  assert.doesNotMatch(slide, /typeface="\+m[jn]-/);
});

test('A shape with no fill reads as none, and one without a fill of its own keeps its style’s', async () => {
  const { slide } = await deckOf('inherited.pptx');
  const [outlined, styled] = slide.split('<p:sp>').slice(3);
  // No fill: the converter finds no colour and no style fill; the outline stays.
  assert.match(outlined, /<a:solidFill><a:schemeClr val="iroriNone"\/><\/a:solidFill>/);
  assert.doesNotMatch(outlined, /noFill|fillRef/);
  assert.match(outlined, /<a:ln><a:solidFill><a:srgbClr val="000000"\/>/);
  // No fill of its own: the style's accent fill still applies, not the outline's black.
  assert.match(styled, /<p:spPr><a:solidFill><a:schemeClr val="iroriNone"\/><\/a:solidFill>/);
  assert.match(styled, /<a:fillRef idx="3"><a:schemeClr val="accent1"\/>/);
});

test('A plain deck keeps every slide and its escaped text', async () => {
  const { zip, slide } = await deckOf('sample.pptx');
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slides.length, 3);
  assert.match(slide, /四半期レビュー &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
