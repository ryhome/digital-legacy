// A deliberate, short-lived hold on the 24 words, used only by the plate print view — the one
// screen that needs the phrase after it has been entered. Released on lock and on leaving print.

let words = null;

export function hold(list) { release(); words = list.slice(); }
export function heldWords() { return words; }
export function release() {
  if (words) words.fill('');
  words = null;
}
