/**
 * "While you wait: what MOSAI does" — general product info shown on the kit
 * loader. These cards are never progress: they say what the product does,
 * not what the job has done. Plain words, no promises of results.
 */

export type Explainer = { id: string; title: string; body: string };

export const EXPLAINER_ROTATE_MS = 6_000;

export const EXPLAINERS: readonly Explainer[] = [
  {
    id: "profile",
    title: "One business profile",
    body: "You tell MOSAI about your business once. Every tool reads the same profile, so you never type it twice.",
  },
  {
    id: "website",
    title: "A website you can change",
    body: "Your website starts from your profile. Change the words and pictures yourself, and put it on the web when you are ready.",
  },
  {
    id: "posts",
    title: "Posts for your channels",
    body: "Get posts written for the places you are active. Copy them, edit them, or plan them once you connect an account.",
  },
  {
    id: "customers",
    title: "Your customers in one list",
    body: "Keep track of who your customers are, what they asked for, and when to get back to them.",
  },
  {
    id: "growth",
    title: "A growth dashboard",
    body: "See visits, bookings and sales in one place, with where each number came from.",
  },
  {
    id: "plan",
    title: "Next steps each week",
    body: "MOSAI suggests a few things to do this week, and tells you which come from your facts and which are guesses.",
  },
];

/** The next card index, wrapping at both ends. */
export function nextExplainer(index: number, step: 1 | -1, count = EXPLAINERS.length): number {
  return (((index + step) % count) + count) % count;
}
