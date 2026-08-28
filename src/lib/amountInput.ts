/**
 * Numpad amount buffer helpers.
 *
 * The buffer is the raw string the user has typed ("12", "12.", "12.5").
 * Keeping it as text — rather than a number — is what makes "12." and "12.50"
 * render the way the user typed them mid-entry.
 */

const MAX_WHOLE_DIGITS = 7;

/** Apply one numpad key (`0`-`9`, `.`, `back`) to the buffer. */
export function pushAmountKey(buffer: string, key: string): string {
  if (key === "back") return buffer.slice(0, -1);

  if (key === ".") {
    if (buffer.includes(".")) return buffer;
    return buffer === "" ? "0." : `${buffer}.`;
  }

  if (!/^[0-9]$/.test(key)) return buffer;

  const [whole, frac] = buffer.split(".");
  if (frac !== undefined) {
    if (frac.length >= 2) return buffer;
    return `${whole}.${frac}${key}`;
  }
  if (buffer === "0") return key; // no leading zeros
  if (buffer.length >= MAX_WHOLE_DIGITS) return buffer;
  return buffer + key;
}

/** Buffer → integer cents. */
export function amountToCents(buffer: string): number {
  if (!buffer) return 0;
  const [whole = "", frac = ""] = buffer.split(".");
  const wholeCents = whole === "" ? 0 : parseInt(whole, 10) * 100;
  const fracCents = parseInt(`${frac}00`.slice(0, 2), 10);
  return wholeCents + (Number.isNaN(fracCents) ? 0 : fracCents);
}

/** Integer cents → an editable buffer, e.g. `1230` → `"12.30"`. */
export function centsToBuffer(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** What to show in the big amount readout while typing. */
export function displayAmount(buffer: string): string {
  return buffer === "" ? "0" : buffer;
}
