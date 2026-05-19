/** Short social messages — don't attach workspace context or reuse agent thread. */
export function isSimpleGreeting(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 48) return false;
  return /^(hi|hello|hey|howdy|yo|sup|hiya|thanks|thank you|thx|good morning|good afternoon|good evening)[\s!.?,']*$/i.test(
    t
  );
}
