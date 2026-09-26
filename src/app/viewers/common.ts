/** What every format's view receives from the viewer frame. */
export interface ViewProps {
  bytes: Uint8Array;
  /** A multiplier of the view's own fitted size; 1 fits the stage. */
  zoom: number;
  /** The stage's inner width in CSS pixels, for fitting. */
  width: number;
  /** A short summary for the viewer bar, such as the page count. */
  onInfo(text: string): void;
  /** Opens an http(s) link from the file in the browser. */
  onLink(url: string): void;
}
