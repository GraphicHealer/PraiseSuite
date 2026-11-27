/**
 * OpenSong's shipped theme list — the <theme_list> options from its
 * language file, offered as checkboxes in the advanced song editor.
 * Songs store a "; "-separated selection in <theme> (trailing "; " kept).
 */
export const OPENSONG_THEMES: readonly string[] = [
  "Christ: Attributes",
  "Christ: Birth",
  "Christ: Death/Atonement",
  "Christ: Power/Majesty",
  "Christ: Love/Mercy",
  "Christ: Resurrection",
  "Christ: Second Coming",
  "Christ: Victory",
  "Church: Commitment/Obedience",
  "Church: Country",
  "Church: Eternal Life/Heaven",
  "Church: Evangelism",
  "Church: Family/Fellowship",
  "Church: Fellowship w/ God",
  "Church: Purity/Holiness",
  "Church: Repentance/Salvation",
  "Church: Renewal",
  "Church: Service/Ministry",
  "Church: Spiritual Hunger",
  "Fruit: Faith/Hope",
  "Fruit: Love",
  "Fruit: Joy",
  "Fruit: Peace/Comfort",
  "Fruit: Patience/Kindness",
  "Fruit: Humility/Meekness",
  "God: Attributes",
  "God: Creator/Creation",
  "God: Father",
  "God: Guidance/Care",
  "God: Holy Spirit",
  "God: Holiness",
  "God: Love/Mercy",
  "God: Power/Majesty",
  "God: Promises",
  "God: Victory",
  "God: Word",
  "Worship: Assurance/Trust",
  "Worship: Call/Opening",
  "Worship: Celebration",
  "Worship: Declaration",
  "Worship: Intimacy",
  "Worship: Invitation",
  "Worship: Praise/Adoration",
  "Worship: Prayer/Devotion",
  "Worship: Provision/Deliverance",
  "Worship: Thankfulness",
];

/** <theme> "A; B; " -> ["A", "B"] (OpenSong SongThemes split on ";"). */
export function splitThemes(theme: string | null): string[] {
  return (theme ?? "")
    .split(";")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** ["A", "B"] -> "A; B; " — OpenSong's stored form keeps the trailing "; ". */
export function joinThemes(themes: readonly string[]): string {
  return themes.length === 0 ? "" : themes.join("; ") + "; ";
}
