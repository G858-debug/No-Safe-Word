import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Story Excerpts",
  description:
    "Read sample excerpts from No Safe Word contemporary romance fiction by Nontsikelelo Mabaso.",
};

const excerpts = [
  {
    title: "The Arrangement",
    genre: "Contemporary Romance",
    description:
      "When two professionals from different worlds agree to a mutually beneficial arrangement, neither expects the lines between convenience and genuine feeling to blur so quickly.",
    excerpt: `The restaurant was the kind of place that whispered money — soft lighting, heavy linen napkins, and a wine list that read like a small novel. Lerato adjusted her blazer and scanned the room until her gaze landed on him.

He was already watching her. Tall, composed, with the kind of quiet confidence that came from knowing exactly who he was. He stood as she approached, and something about the gesture — old-fashioned, unhurried — made her pulse quicken despite herself.

"Lerato?" His voice was deeper than she'd expected from their phone calls. Warmer, too.

"Sibusiso." She extended her hand, and when he took it, his grip was firm but gentle. "Thank you for meeting me."

"Thank you for agreeing to this." He pulled out her chair, and she caught the faintest trace of cologne — something woody and warm. "I know the whole thing sounds... unconventional."

She settled into her seat and met his eyes. Dark brown, steady, with a hint of something she couldn't quite read. "Unconventional is fine. I've never been particularly traditional."

A smile tugged at the corner of his mouth. "Neither have I."`,
  },
  {
    title: "After Hours",
    genre: "Workplace Romance",
    description:
      "A chance encounter at the office after midnight leads two colleagues to discover that the tension between them has been building for far longer than either was willing to admit.",
    excerpt: `The office at midnight was a different country. The open-plan floor that buzzed with noise during the day was now vast and silent, lit only by the blue glow of her monitor and the city lights pressing against the windows.

Naledi rubbed her eyes and reached for her coffee — stone cold. She grimaced and pushed it aside, then froze at the sound of footsteps in the corridor.

"Working late again?"

She didn't need to turn around to know who it was. That voice had been living rent-free in her thoughts for the better part of six months.

"Could say the same about you, Thabo." She swivelled in her chair to face him. He was leaning against the doorframe, tie loosened, sleeves rolled to his elbows. The formal veneer of the daytime version of him had softened into something far more dangerous.

"Deadline," he said simply, holding up a flash drive. "You?"

"Same." She gestured at the spreadsheets colonising her screen. "The Moyo account won't reconcile itself."

He walked closer — not to his own desk across the room, but to hers. He set the flash drive down and perched on the edge of her desk, close enough that she caught the scent of his aftershave mixed with something that was just him.

"You know," he said quietly, "we keep running into each other like this."

"It's a shared office, Thabo. That's generally how offices work."

He laughed — low, genuine — and the sound did something to her that no spreadsheet ever could.`,
  },
  {
    title: "Cape Town Confidential",
    genre: "Romantic Drama",
    description:
      "Against the backdrop of Cape Town's glittering social scene, a journalist and a hotel heir find themselves drawn together by a story that could either make her career or break his family apart.",
    excerpt: `The view from the terrace at The Silo was the kind that made you forget your troubles — Table Mountain draped in its evening cloth of cloud, the harbour glittering below like scattered diamonds. But Zintle wasn't here for the view.

She spotted him at the far end of the bar, nursing what looked like whisky and staring at the sunset with the expression of a man carrying more weight than his tailored shoulders suggested.

Kamogelo Mthembu. Heir to the Mthembu hospitality empire. And, if her sources were right, sitting on a secret that would shake Cape Town's most powerful family to its foundations.

She smoothed her dress — a deep burgundy number she'd agonised over for an hour — and made her approach.

"Beautiful evening," she said, settling onto the barstool beside him.

He turned, and she understood immediately why the society pages couldn't get enough of him. It wasn't just that he was handsome, though he certainly was. It was the way he looked at you — as though you were the only interesting thing in a room full of distractions.

"It is now," he said, and the line should have been corny, but he delivered it with such unguarded sincerity that she felt her carefully prepared journalist's detachment waver.

This was going to be more complicated than she'd planned.`,
  },
];

export default function AccessStoriesPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1
        className="text-3xl font-bold text-amber-50 sm:text-4xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Story Excerpts
      </h1>
      <p className="mt-4 text-base text-warm-300">
        Sample excerpts from our contemporary romance fiction collection.
        Each story explores love and relationships in modern South Africa.
      </p>

      <div className="mt-12 space-y-16">
        {excerpts.map((story) => (
          <article key={story.title}>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-amber-600">
              {story.genre}
            </div>
            <h2
              className="text-2xl font-bold text-amber-50"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {story.title}
            </h2>
            <p className="mt-3 text-sm italic text-warm-400">
              {story.description}
            </p>
            <div className="mt-6 rounded-xl border border-amber-900/20 bg-amber-950/10 p-6">
              <div className="space-y-4 text-[15px] leading-relaxed text-warm-200">
                {story.excerpt.split("\n\n").map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-16 rounded-xl border border-amber-900/20 bg-amber-950/10 p-6 text-center">
        <p className="text-sm text-warm-300">
          These are sample excerpts from our contemporary romance fiction
          collection. The first chapter of every story is free to read.
        </p>
      </div>
    </div>
  );
}
