import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Nontsikelelo Mabaso",
  description:
    "Learn about Nontsikelelo Mabaso, the South African author behind No Safe Word contemporary romance fiction.",
};

export default function AccessAboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1
        className="text-3xl font-bold text-amber-50 sm:text-4xl"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        About the Author
      </h1>

      {/* Author bio */}
      <section className="mt-8 space-y-5 text-base leading-relaxed text-warm-200">
        <h2
          className="text-xl font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Nontsikelelo Mabaso
        </h2>
        <p>
          Nontsikelelo Mabaso is a South African author and creative
          entrepreneur based in Johannesburg. She is the founder of No Safe
          Word, a digital publishing platform specialising in contemporary
          romance fiction.
        </p>
        <p>
          With a passion for storytelling and a deep appreciation for the
          richness of South African culture, Nontsikelelo writes stories that
          explore love, relationships, and human connection in modern-day South
          Africa. Her work draws on the vibrant landscapes, diverse communities,
          and complex social dynamics that make the country unique.
        </p>
        <p>
          Nontsikelelo believes that romance fiction is a powerful medium for
          exploring the full spectrum of human emotion. Her stories feature
          relatable characters navigating the joys and challenges of
          contemporary relationships, set against backdrops that range from
          bustling Johannesburg neighbourhoods to the serene coastlines of
          KwaZulu-Natal.
        </p>
        <p>
          Through No Safe Word, Nontsikelelo aims to provide a platform for
          romance fiction that is authentically South African, representing
          voices and experiences that are often underrepresented in the genre.
        </p>
      </section>

      {/* Vision */}
      <section className="mt-12 rounded-xl border border-amber-900/20 bg-amber-950/10 p-6">
        <h2
          className="text-xl font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Our Vision
        </h2>
        <div className="mt-4 space-y-4 text-base leading-relaxed text-warm-200">
          <p>
            No Safe Word was created to fill a gap in the South African digital
            publishing landscape. While romance fiction is one of the most
            popular genres globally, there are few platforms dedicated to
            producing original contemporary romance stories rooted in South
            African life.
          </p>
          <p>
            The platform combines serialised storytelling with original
            illustrations, creating an immersive reading experience that goes
            beyond traditional e-books. Stories are released in parts, building
            anticipation and allowing readers to follow along as narratives
            unfold.
          </p>
          <p>
            No Safe Word is committed to quality storytelling, thoughtful
            character development, and narratives that resonate with readers who
            see themselves reflected in the stories they read.
          </p>
        </div>
      </section>

      {/* What we publish */}
      <section className="mt-12">
        <h2
          className="text-xl font-bold text-amber-50"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          What We Publish
        </h2>
        <div className="mt-4 space-y-4 text-base leading-relaxed text-warm-200">
          <p>
            No Safe Word publishes contemporary romance fiction. Our stories
            feature:
          </p>
          <ul className="ml-4 list-disc space-y-2 text-warm-300">
            <li>
              Original serialised narratives exploring love, relationships, and
              emotional connection
            </li>
            <li>
              Authentic South African settings, characters, and cultural contexts
            </li>
            <li>
              Thoughtful character development and compelling plot lines
            </li>
            <li>
              Original illustrations accompanying each story
            </li>
            <li>
              A mix of genres within romance, including dramatic romance,
              slow-burn stories, and passionate love stories
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
