// Shared by the Bonus book builders: the Bonus group's picker has one sub-category per gimmick (its blurb says what the gimmick is), and
// a book that comes in several sizes says only its size and tier spread.
const TIERS = ['Beginner', 'Medium', 'Hard'];

/** "12×12 boards. Medium to Hard." from the size and the book's tier counts ({ Medium: 120, Hard: 130 }). */
export function sizeBlurb(nice, tiers) {
  const t = TIERS.filter((x) => tiers[x]);
  return `${nice} boards. ${t.length > 1 ? `${t[0]} to ${t.at(-1)}` : `All ${t[0]}`}.`;
}

/** Add or refresh a sub-category of the Bonus group (an icon already in the manifest is kept). */
export function setBonusSub(manifest, name, icon, blurb) {
  const g = manifest.groups.find((x) => x.name === 'Bonus');
  g.subs ||= {};
  g.subs[name] = { icon: g.subs[name]?.icon || icon, ...(blurb ? { blurb } : {}) };
}
